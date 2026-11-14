// 订阅登录（OAuth），按提供商通用：直接跑 pi-ai 提供商自己的登录流程（models.login），不自己重写协议。
// 流程里要给他看的（授权网址、设备码、进度）记在这次登录上；流程要他交的东西（回调地址、代码）挂成一个等着的提问，
// 客户端或 Mac App 把浏览器跳转到的地址（如 http://127.0.0.1:1455/...）交上来就接着走。凭证由 Models 存进库，这里
// 不碰；出错时只回一句不带凭证的原因。同一家同时只跑一次登录（例如 ChatGPT 的回调端口只有一个）。

import { randomUUID } from 'node:crypto';
import type { AuthEvent, AuthPrompt } from '@earendil-works/pi-ai';
import type { ProviderLoginView } from '../../shared/api/model-providers.ts';
import { looksLikeSecret } from '../brain/index.ts';
import { errorCategory, safeLog } from '../shared-log.ts';
import { KernelModelError, type KernelModels } from './models.ts';

// 一次登录最多等这么久（他去浏览器里点授权）；过了就取消，回调端口放开。
export const LOGIN_TTL_MS = 10 * 60_000;
// 开始登录时等流程给出授权网址（或设备码、提问）的时间：够本机起回调服务、拼网址。
export const LOGIN_START_WAIT_MS = 15_000;
// 出错原因最多回这么长。
const ERROR_CHARS = 200;
// 流程让选登录方式时选这一个（pi-ai 里浏览器登录的选项 id）；没有就选第一个（它们都把默认的放第一个）。
const BROWSER_METHOD = 'browser';
// 登录完、失败、取消后这条记录留多久，好让客户端读到结果。
const KEEP_FINISHED_MS = 10 * 60_000;

interface Pending {
  prompt: AuthPrompt;
  resolve(value: string): void;
  reject(error: Error): void;
}

interface Session {
  view: ProviderLoginView;
  abort: AbortController;
  pending: Pending | null;
  changed: () => void;
  timer: ReturnType<typeof setTimeout>;
}

function safeReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const first = message.split('\n')[0]?.trim() ?? '';
  if (first === '' || looksLikeSecret(first)) {
    return '登录没完成，请重试。';
  }
  return first.length > ERROR_CHARS ? `${first.slice(0, ERROR_CHARS)}…` : first;
}

export class ProviderLogins {
  readonly #models: KernelModels;
  readonly #sessions = new Map<string, Session>();
  readonly #startWaitMs: number;

  constructor(models: KernelModels, options: { startWaitMs?: number } = {}) {
    this.#models = models;
    this.#startWaitMs = options.startWaitMs ?? LOGIN_START_WAIT_MS;
  }

  /** 开始登录：等到流程给出授权网址 / 设备码 / 要他交的东西（或直接成了、败了）再回。 */
  async start(providerId: string): Promise<ProviderLoginView> {
    if (!this.#models.supportsOAuth(providerId)) {
      throw new KernelModelError('invalid', '这家没有订阅登录，填 key 就行。');
    }
    for (const session of this.#sessions.values()) {
      if (session.view.providerId === providerId && session.view.status === 'waiting') {
        this.#finish(session, 'cancelled', '又开了一次登录，这次取消了。');
      }
    }
    let notify = (): void => undefined;
    const ready = new Promise<void>((resolve) => {
      notify = resolve;
    });
    const session: Session = {
      view: { id: `login-${randomUUID()}`, providerId, status: 'waiting', url: null, instructions: null,
        deviceCode: null, prompt: null, progress: null, error: null },
      abort: new AbortController(),
      pending: null,
      changed: () => notify(),
      timer: setTimeout(() => this.#finish(session, 'cancelled', '登录等太久了，已取消；要连接再点一次。'), LOGIN_TTL_MS),
    };
    session.timer.unref();
    this.#sessions.set(session.view.id, session);
    void this.#run(session);
    const waited = new Promise<void>((resolve) => {
      setTimeout(resolve, this.#startWaitMs).unref();
    });
    await Promise.race([ready, waited]);
    return { ...session.view };
  }

  get(loginId: string): ProviderLoginView {
    return { ...this.#session(loginId).view };
  }

  /** 交上流程在等的东西（回调地址、代码）。 */
  complete(loginId: string, input: string): ProviderLoginView {
    const session = this.#session(loginId);
    if (session.pending === null) {
      throw new KernelModelError('invalid', session.view.status === 'waiting' ? '这次登录现在不用交东西，等它走完。'
        : '这次登录已经结束了。');
    }
    const pending = session.pending;
    session.pending = null;
    session.view.prompt = null;
    pending.resolve(input.trim());
    return { ...session.view };
  }

  cancel(loginId: string): ProviderLoginView {
    const session = this.#session(loginId);
    if (session.view.status === 'waiting') {
      this.#finish(session, 'cancelled', null);
    }
    return { ...session.view };
  }

  /** 关服务：没走完的登录都取消。 */
  stop(): void {
    for (const session of this.#sessions.values()) {
      if (session.view.status === 'waiting') {
        this.#finish(session, 'cancelled', null);
      }
    }
  }

  #session(loginId: string): Session {
    const session = this.#sessions.get(loginId);
    if (session === undefined) {
      throw new KernelModelError('not_found', '没有这次登录（可能已经过期），重新点一次连接。');
    }
    return session;
  }

  async #run(session: Session): Promise<void> {
    try {
      await this.#models.models.login(session.view.providerId, 'oauth', {
        signal: session.abort.signal,
        notify: (event) => this.#event(session, event),
        prompt: (prompt) => this.#prompt(session, prompt),
      }, { getDeviceId: () => this.#models.deviceId(), agentName: 'Plasticine' });
      this.#finish(session, 'done', null);
    } catch (error) {
      if (session.view.status === 'waiting') {
        safeLog('warn', 'model_login_failed', { category: errorCategory(error) });
        this.#finish(session, 'failed', safeReason(error));
      }
    }
  }

  #event(session: Session, event: AuthEvent): void {
    if (event.type === 'auth_url') {
      session.view.url = event.url;
      session.view.instructions = event.instructions ?? null;
    } else if (event.type === 'device_code') {
      session.view.deviceCode = { userCode: event.userCode, verificationUri: event.verificationUri };
    } else if (event.type === 'progress' || event.type === 'info') {
      session.view.progress = event.message;
    }
    session.changed();
  }

  #prompt(session: Session, prompt: AuthPrompt): Promise<string> {
    // 流程先问用哪种方式登录（pi-ai 的 OpenAI Codex：浏览器 / 设备码）：界面没有选择题、也不显示设备码，直接走浏览器
    // 那一路——授权网址照常打开，回调由本体收、客户端代收或他贴回来（11-14 Aaron 点 Codex 登录没弹页、按钮点不动）。
    if (prompt.type === 'select') {
      const choice = prompt.options.find((option) => option.id === BROWSER_METHOD) ?? prompt.options[0];
      if (choice !== undefined) {
        return Promise.resolve(choice.id);
      }
    }
    return new Promise((resolve, reject) => {
      const placeholder = 'placeholder' in prompt ? prompt.placeholder ?? null : null;
      session.pending = { prompt, resolve, reject };
      session.view.prompt = { type: prompt.type, message: prompt.message, placeholder };
      prompt.signal?.addEventListener('abort', () => {
        if (session.pending?.prompt === prompt) {
          session.pending = null;
          session.view.prompt = null;
        }
        reject(new Error('这一步不用了（浏览器那边已经回来了）。'));
      }, { once: true });
      session.changed();
    });
  }

  #finish(session: Session, status: ProviderLoginView['status'], error: string | null): void {
    session.view.status = status;
    session.view.error = error;
    session.view.prompt = null;
    clearTimeout(session.timer);
    if (status !== 'done') {
      session.abort.abort();
    }
    session.pending?.reject(new Error('登录结束了。'));
    session.pending = null;
    session.changed();
    setTimeout(() => this.#sessions.delete(session.view.id), KEEP_FINISHED_MS).unref();
  }
}
