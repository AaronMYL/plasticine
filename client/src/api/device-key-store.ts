// 这台设备的签名钥匙放在哪：浏览器里是 IndexedDB。存进去的是 CryptoKey 对象本身（结构化克隆），不是私钥字节——
// 钥匙生成时就不可导出，存取都不会把它变成明文；sessionStorage / localStorage 里一个字都不放（第 90 条 ②）。
// 读出来的东西是外部输入：形状不对就当没有，不拿来签。测试和没有 IndexedDB 的环境用内存里的那一份。

import { Value } from 'typebox/value';
import { PublicKeyJwkSchema, type PublicKeyJwk } from './shared.ts';

/**
 * pending 生成了还没登记上（登记的回执可能丢了）· registered 服务端认了这把 · too_late 服务端说配对已超过 10 分钟，
 * 这台设备只能重新配对。
 */
export type DeviceKeyState = 'pending' | 'registered' | 'too_late';

export interface StoredDeviceKey {
  /** 这把钥匙属于哪台设备（会话里的 device.id）；重新配对成了另一台设备就换新钥匙。 */
  deviceId: string;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicJwk: PublicKeyJwk;
  /** 登记请求的原样请求体（带 requestId）：回执丢了重发要一字不差，服务端按请求体摘要去重。 */
  registerBody: string;
  state: DeviceKeyState;
}

/**
 * 几个标签页共用一份：取用和改都在一次原子操作里判断（IndexedDB 的同一个读写事务里先读后写），两个标签页同时
 * 发现「还没有钥匙」时不会各写一把、互相覆盖（审查 5087993 P2）。
 */
export interface DeviceKeyStore {
  load(): Promise<StoredDeviceKey | null>;
  /** 这台设备已经有一把就用存着的那把（丢掉 candidate）；没有（或存的是别的设备的）才写 candidate。返回用哪把。 */
  claim(candidate: StoredDeviceKey): Promise<StoredDeviceKey>;
  /** 改状态（登记上了、太晚了）：只在存着的还是同一把钥匙时写，不覆盖别的标签页换上的新钥匙。 */
  update(key: StoredDeviceKey): Promise<void>;
}

/** 同一台设备的同一把钥匙（公钥相同）。 */
export function sameKey(a: StoredDeviceKey, b: StoredDeviceKey): boolean {
  return a.deviceId === b.deviceId && a.publicJwk.x === b.publicJwk.x && a.publicJwk.y === b.publicJwk.y;
}

/** claim 的判断：存着的是这台设备的就用它。 */
function claimed(stored: StoredDeviceKey | null, candidate: StoredDeviceKey): StoredDeviceKey {
  return stored !== null && stored.deviceId === candidate.deviceId ? stored : candidate;
}

export class MemoryDeviceKeyStore implements DeviceKeyStore {
  private key: StoredDeviceKey | null = null;

  async load(): Promise<StoredDeviceKey | null> {
    return this.key;
  }

  async claim(candidate: StoredDeviceKey): Promise<StoredDeviceKey> {
    this.key = claimed(this.key, candidate);
    return this.key;
  }

  async update(key: StoredDeviceKey): Promise<void> {
    if (this.key !== null && sameKey(this.key, key)) {
      this.key = key;
    }
  }
}

const DB_NAME = 'plasticine-device';
const DB_VERSION = 1;
const STORE_NAME = 'keys';
const RECORD_ID = 'signing';

function isCryptoKey(value: unknown, type: KeyType): value is CryptoKey {
  return typeof CryptoKey !== 'undefined' && value instanceof CryptoKey && value.type === type;
}

/** IndexedDB 里读出来的一条：每样都查过才用。 */
export function checkStoredKey(value: unknown): StoredDeviceKey | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Partial<Record<keyof StoredDeviceKey, unknown>>;
  const states: readonly unknown[] = ['pending', 'registered', 'too_late'];
  const { deviceId, privateKey, publicKey, publicJwk, registerBody, state } = record;
  if (
    typeof deviceId !== 'string' ||
    !isCryptoKey(privateKey, 'private') ||
    privateKey.extractable ||
    !isCryptoKey(publicKey, 'public') ||
    !Value.Check(PublicKeyJwkSchema, publicJwk) ||
    typeof registerBody !== 'string' ||
    !states.includes(state)
  ) {
    return null;
  }
  return { deviceId, privateKey, publicKey, publicJwk, registerBody, state: state as DeviceKeyState };
}

function requestResult<T>(request: IDBRequest<T>, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error(`${what}：${request.error?.message ?? '原因不明'}`));
  });
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  const request = factory.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    request.result.createObjectStore(STORE_NAME);
  };
  return requestResult(request, '打不开存签名钥匙的 IndexedDB');
}

function transactionDone(transaction: IDBTransaction, what: string): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(new Error(`${what}：${transaction.error?.message ?? '原因不明'}`));
    transaction.onabort = () => reject(new Error(`${what}：事务被中止`));
  });
}

export class IndexedDbDeviceKeyStore implements DeviceKeyStore {
  private readonly factory: IDBFactory;

  constructor(factory: IDBFactory) {
    this.factory = factory;
  }

  async load(): Promise<StoredDeviceKey | null> {
    const db = await openDatabase(this.factory);
    try {
      const store = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME);
      const value: unknown = await requestResult(store.get(RECORD_ID), '读不出签名钥匙');
      if (value === undefined) {
        return null;
      }
      const key = checkStoredKey(value);
      if (key === null) {
        console.warn('IndexedDB 里的签名钥匙格式不对，不用它');
      }
      return key;
    } finally {
      db.close();
    }
  }

  async claim(candidate: StoredDeviceKey): Promise<StoredDeviceKey> {
    let chosen = candidate;
    await this.readWrite('签名钥匙没存进 IndexedDB', (stored) => {
      chosen = claimed(stored, candidate);
      return chosen === candidate ? candidate : null;
    });
    return chosen;
  }

  async update(key: StoredDeviceKey): Promise<void> {
    await this.readWrite('签名钥匙的状态没存进 IndexedDB', (stored) =>
      stored !== null && sameKey(stored, key) ? key : null,
    );
  }

  /**
   * 一个读写事务里先读、再按读到的决定写不写（decide 返回 null 就不写）。同一个库同一个仓的读写事务由浏览器排队，
   * 两个标签页的判断不会交错。decide 必须同步：事务在没有待办请求时就自动提交了。
   */
  private async readWrite(
    what: string,
    decide: (stored: StoredDeviceKey | null) => StoredDeviceKey | null,
  ): Promise<void> {
    const db = await openDatabase(this.factory);
    try {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const read = store.get(RECORD_ID);
      read.onsuccess = () => {
        const value: unknown = read.result;
        const next = decide(value === undefined ? null : checkStoredKey(value));
        if (next !== null) {
          store.put(next, RECORD_ID);
        }
      };
      await transactionDone(transaction, what);
    } finally {
      db.close();
    }
  }
}

/** 浏览器里的那一份；没有 IndexedDB 或 WebCrypto 时返回 null，界面就地说这台设备签不了名。 */
export function browserDeviceKeyStore(): DeviceKeyStore | null {
  if (typeof indexedDB === 'undefined' || typeof crypto === 'undefined' || crypto.subtle === undefined) {
    return null;
  }
  return new IndexedDbDeviceKeyStore(indexedDB);
}
