import { randomUUID } from 'node:crypto';
import type { AuthEvent, AuthPrompt } from '@earendil-works/pi-ai';
import type { ProviderLoginView } from '../../shared/api/model-providers.ts';
import { looksLikeSecret } from '../memory/index.ts';
import { errorCategory, safeLog } from '../util/index.ts';
import { KernelModelError, type KernelModels } from './models.ts';

export const LOGIN_TTL_MS = 10 * 60_000;
export const LOGIN_START_WAIT_MS = 15_000;
const ERROR_CHARS = 200;
const BROWSER_METHOD = 'browser';
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
