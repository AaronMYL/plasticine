// 从 Chrome 搬一次登录（只在他点「导入」那一下、在这台电脑上读一次；不经本体、不进日志）。照 Mac 壳
// login-import-chrome.swift 的做法，Electron 版两个系统都做：
// - Mac：钥匙串里「Chrome Safe Storage」的口令（读时系统弹框问他）→ PBKDF2-HMAC-SHA1（盐 saltysalt、1003 次、16 字节）
//   → AES-128-CBC（IV 是 16 个空格）解开 v10 开头的值。
// - Windows：Local State 里 os_crypt.encrypted_key（去掉 DPAPI 前缀，用 DPAPI 在他的账户下解开）→ AES-256-GCM 解开
//   v10 / v11 开头的值。Chrome 127 起的 v20（App-Bound 加密）只有 Chrome 自己解得开，跳过并计数，如实说。
// - 库版本 24 起解开的明文前面多 32 字节的域名摘要。Chrome 开着时库可能锁着：先复制到临时目录再读，读完删掉。
// 解不开、过期的条目跳过并计数，不猜。

import { createDecipheriv, pbkdf2Sync } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** Chrome 的时间从 1601 年起算（微秒）。 */
const WINDOWS_EPOCH_MICROS = 11_644_473_600_000_000n;
/** 库版本从这个起，解开的明文前面带 32 字节的域名 SHA-256。 */
export const HASHED_DOMAIN_VERSION = 24;

export type ChromeKey = { scheme: 'cbc'; key: Buffer } | { scheme: 'gcm'; key: Buffer };

export interface ChromeCookie {
  host: string;
  name: string;
  value: string;
  path: string;
  /** 秒（Unix 时间）；会话 Cookie 是 null。 */
  expires: number | null;
  secure: boolean;
  httpOnly: boolean;
  /** Chrome：-1 没写、0 none、1 lax、2 strict。 */
  sameSite: number;
}

export class ChromeImportProblem extends Error {}

/** Mac / Linux 的 v10：口令派生 AES-128 钥匙。Mac 1003 次；Linux 没有钥匙环时口令是 peanuts、1 次。 */
export function cbcKey(secret: string, rounds: number): ChromeKey {
  return { scheme: 'cbc', key: pbkdf2Sync(secret, 'saltysalt', rounds, 16, 'sha1') };
}

export function decryptValue(encrypted: Buffer, key: ChromeKey, dropDomainHash: boolean): string | null {
  const prefix = encrypted.subarray(0, 3).toString('latin1');
  let plain: Buffer;
  try {
    if (key.scheme === 'cbc' && prefix === 'v10') {
      const decipher = createDecipheriv('aes-128-cbc', key.key, Buffer.alloc(16, 0x20));
      plain = Buffer.concat([decipher.update(encrypted.subarray(3)), decipher.final()]);
    } else if (key.scheme === 'gcm' && (prefix === 'v10' || prefix === 'v11')) {
      const nonce = encrypted.subarray(3, 15);
      const tag = encrypted.subarray(encrypted.length - 16);
      const decipher = createDecipheriv('aes-256-gcm', key.key, nonce);
      decipher.setAuthTag(tag);
      plain = Buffer.concat([decipher.update(encrypted.subarray(15, encrypted.length - 16)), decipher.final()]);
    } else {
      return null;
    }
  } catch (error) {
    if (error instanceof Error && /bad decrypt|unable to authenticate|wrong final block/i.test(error.message)) {
      return null;
    }
    throw error;
  }
  if (dropDomainHash) {
    if (plain.length < 32) {
      return null;
    }
    plain = plain.subarray(32);
  }
  const text = plain.toString('utf8');
  return Buffer.from(text, 'utf8').equals(plain) ? text : null;
}

/** 复制一份再只读打开（Chrome 开着时原库锁着）；用完连同临时目录一起删掉。 */
export function withCopy<T>(database: string, read: (db: DatabaseSync) => T): T {
  if (!existsSync(database)) {
    throw new ChromeImportProblem('这台电脑上没找到 Chrome 的 Cookie 库：Chrome 装过、登录过吗？');
  }
  const directory = mkdtempSync(join(tmpdir(), 'plasticine-chrome-'));
  try {
    const copy = join(directory, 'Cookies');
    try {
      copyFileSync(database, copy);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
        throw new ChromeImportProblem('Chrome 开着、把 Cookie 库锁住了：先退出 Chrome 再导入。', { cause: error });
      }
      throw error;
    }
    const db = new DatabaseSync(copy, { readOnly: true });
    try {
      return read(db);
    } finally {
      db.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** 有 Cookie 的主机名（不解密，只数）。 */
export function cookieHosts(database: string): string[] {
  return withCopy(database, (db) => db.prepare('SELECT DISTINCT host_key FROM cookies').all()
    .map((row) => String(row.host_key)));
}

export function readCookies(database: string, key: ChromeKey, now: Date): { cookies: ChromeCookie[];
  skipped: number } {
  return withCopy(database, (db) => {
    const meta = db.prepare("SELECT value FROM meta WHERE key = 'version'").get();
    const dropHash = Number(meta?.value ?? 0) >= HASHED_DOMAIN_VERSION;
    const statement = db.prepare('SELECT host_key, name, value, encrypted_value, path, expires_utc, is_secure, '
      + 'is_httponly, samesite FROM cookies');
    // expires_utc 是从 1601 年起的微秒数，超过 JS 安全整数，按 BigInt 读。
    statement.setReadBigInts(true);
    const rows = statement.all();
    const cookies: ChromeCookie[] = [];
    let skipped = 0;
    for (const row of rows) {
      const plain = String(row.value ?? '');
      const encrypted = row.encrypted_value instanceof Uint8Array ? Buffer.from(row.encrypted_value) : Buffer.alloc(0);
      const value = plain !== '' ? plain : decryptValue(encrypted, key, dropHash);
      const micros = BigInt(row.expires_utc as number | bigint);
      const expires = micros === 0n ? null : Number((micros - WINDOWS_EPOCH_MICROS) / 1_000_000n);
      if (value === null || (expires !== null && expires * 1000 <= now.getTime())) {
        skipped += 1;
        continue;
      }
      cookies.push({ host: String(row.host_key), name: String(row.name), value, path: String(row.path || '/'),
        expires, secure: Number(row.is_secure) !== 0, httpOnly: Number(row.is_httponly) !== 0,
        sameSite: Number(row.samesite) });
    }
    return { cookies, skipped };
  });
}

/** Windows：Local State 里加密的钥匙（去掉 DPAPI 前缀，等 DPAPI 解开）。 */
export function windowsEncryptedKey(localState: string): Buffer {
  let parsed: unknown;
  try {
    parsed = JSON.parse(localState);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ChromeImportProblem('Chrome 的 Local State 读不懂，没有导入。', { cause: error });
    }
    throw error;
  }
  const encoded = (parsed as { os_crypt?: { encrypted_key?: unknown } }).os_crypt?.encrypted_key;
  if (typeof encoded !== 'string') {
    throw new ChromeImportProblem('Chrome 的 Local State 里没有钥匙，没有导入。');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.subarray(0, 5).toString('latin1') !== 'DPAPI') {
    throw new ChromeImportProblem('Chrome 的钥匙格式和预想的不一样，没有导入。');
  }
  return bytes.subarray(5);
}

/** 按可注册域名归在一起（够认出来就行：常见的二级后缀多取一段）。 */
export function siteOf(host: string): string {
  const labels = host.replace(/^\./, '').toLowerCase().split('.').filter(Boolean);
  if (labels.length <= 2 || /^\d+$/.test(labels[labels.length - 1] ?? '')) {
    return labels.join('.');
  }
  const tail = labels.slice(-2).join('.');
  const second = /^(?:com|net|org|gov|edu|ac|co)\.[a-z]{2}$/.test(tail);
  return labels.slice(second ? -3 : -2).join('.');
}
