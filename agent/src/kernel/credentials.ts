// pi-ai 的 CredentialStore，存在 plasticine.sqlite 的 kernel_credentials（每家提供商一行）。
// modify 是唯一的写路：同一家提供商的读改写排成一串（OAuth 刷新在里面跑，并发请求不会刷两次）。一个进程只有一个
// 写库的连接（state/db.ts），所以进程内串行就够了。凭证不进日志、不进接口响应：list 只给「哪家、什么类型」。

import type { AuthOperationOptions, Credential, CredentialInfo, CredentialStore } from '@earendil-works/pi-ai';
import type { StateService } from '../state/index.ts';

export type CredentialState = Pick<StateService, 'kernelCredentials'>;

function isCredential(value: unknown): value is Credential {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const type = Reflect.get(value, 'type');
  return type === 'api_key' || type === 'oauth';
}

function checkCancelled(options: AuthOperationOptions | undefined): void {
  if (options?.signal?.aborted === true) {
    throw new Error('凭证操作被取消了。');
  }
}

// ChatGPT 订阅令牌里账号和套餐所在的声明（pi-ai 的 openai-codex 登录拿到的就是它）；别家没有就看标准的 email。
const OPENAI_PROFILE_CLAIM = 'https://api.openai.com/profile';
const OPENAI_AUTH_CLAIM = 'https://api.openai.com/auth';
// key 短于这个就不露尾巴（露 4 位等于露了大半）。
const KEY_HINT_MIN = 12;

function tokenClaims(token: string): Record<string, unknown> {
  const payload = token.split('.')[1];
  if (payload === undefined) {
    return {};
  }
  try {
    const value: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
  } catch (error) {
    if (error instanceof SyntaxError) {
      return {};
    }
    throw error;
  }
}

export class SqliteCredentialStore implements CredentialStore {
  readonly #state: CredentialState;
  readonly #chains = new Map<string, Promise<unknown>>();

  constructor(state: CredentialState) {
    this.#state = state;
  }

  /** 同一家提供商的操作一个接一个；前一个失败不挡后一个。 */
  #enqueue<T>(providerId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.#chains.get(providerId) ?? Promise.resolve();
    const next = previous.then(work, work);
    const settled = next.then(() => undefined, () => undefined);
    this.#chains.set(providerId, settled);
    void settled.then(() => {
      if (this.#chains.get(providerId) === settled) {
        this.#chains.delete(providerId);
      }
    });
    return next;
  }

  #read(providerId: string): Credential | undefined {
    const stored = this.#state.kernelCredentials.read(providerId)?.credential;
    if (stored === undefined) {
      return undefined;
    }
    if (!isCredential(stored)) {
      throw new Error(`库里「${providerId}」的凭证格式不对，要重新连接。`);
    }
    return stored;
  }

  async read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
    checkCancelled(options);
    return this.#read(providerId);
  }

  async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
    checkCancelled(options);
    return this.#state.kernelCredentials.list().flatMap((row) => (row.type === 'api_key' || row.type === 'oauth'
      ? [{ providerId: row.providerId, type: row.type }] : []));
  }

  modify(providerId: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: AuthOperationOptions): Promise<Credential | undefined> {
    return this.#enqueue(providerId, async () => {
      checkCancelled(options);
      const current = this.#read(providerId);
      const next = await fn(current);
      if (next === undefined) {
        return current;
      }
      this.#state.kernelCredentials.write(providerId, next.type, next);
      return next;
    });
  }

  delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
    return this.#enqueue(providerId, async () => {
      checkCancelled(options);
      this.#state.kernelCredentials.clear(providerId);
    });
  }

  /**
   * 列表上认得出是哪个连接：订阅令牌（JWT）里带的账号邮箱和套餐、key 的最后 4 位。只解码不验签——只是给他看的，
   * 不拿来做任何判断；令牌和 key 本身不出这里。
   */
  label(providerId: string): { account: string | null; plan: string | null; keyLast4: string | null } {
    const credential = this.#read(providerId);
    if (credential?.type === 'api_key') {
      const key = String(Reflect.get(credential, 'key') ?? '');
      return { account: null, plan: null, keyLast4: key.length >= KEY_HINT_MIN ? key.slice(-4) : null };
    }
    if (credential?.type !== 'oauth') {
      return { account: null, plan: null, keyLast4: null };
    }
    const claims = tokenClaims(credential.access);
    const profile = Reflect.get(claims, OPENAI_PROFILE_CLAIM);
    const auth = Reflect.get(claims, OPENAI_AUTH_CLAIM);
    const email = claims['email'] ?? (typeof profile === 'object' && profile !== null ? Reflect.get(profile, 'email')
      : undefined);
    const plan = typeof auth === 'object' && auth !== null ? Reflect.get(auth, 'chatgpt_plan_type') : undefined;
    return { account: typeof email === 'string' && email !== '' ? email : null,
      plan: typeof plan === 'string' && plan !== '' ? plan : null, keyLast4: null };
  }

  /** 同步看一眼：这家现在有没有凭证、什么类型（选默认模型时用，不碰凭证内容）。 */
  connectedType(providerId: string): 'api_key' | 'oauth' | null {
    const row = this.#state.kernelCredentials.list().find((entry) => entry.providerId === providerId);
    return row?.type === 'api_key' || row?.type === 'oauth' ? row.type : null;
  }
}
