// 壳这一头的助手调用（第 14 条）：把请求写成一行 JSON 交给助手的 stdin，从 stdout 一块块收回来、按换行切开、
// 按 id 交回等着的那一次调用。不碰 node:child_process：壳（desktop/）拉起进程后，把「写一行」交进来，
// stdout 的每一块 receive 进来，进程退了调 close。每次调用可以带 AbortSignal（取消时也通知助手 cancel）和超时。
// 回执先过 schema：形状不对的按 failed 交回，不当成功。

import { Value } from 'typebox/value';
import {
  HELPER_METHODS, HelperResponseSchema, type HelperErrorCode, type HelperMethod, type HelperParams,
  type HelperResult,
} from './desktop-helper-protocol.ts';

/** 助手回了错误，或调用没走完（超时、取消、助手退出）。 */
export class HelperCallError extends Error {
  readonly code: HelperErrorCode | 'timeout' | 'closed';

  constructor(code: HelperErrorCode | 'timeout' | 'closed', message: string) {
    super(message);
    this.name = 'HelperCallError';
    this.code = code;
  }
}

export interface HelperCallOptions {
  signal?: AbortSignal;
  /** 等多久没回执就放弃（并让助手取消）；不给就一直等。 */
  timeoutMs?: number;
}

interface Pending {
  method: HelperMethod;
  resolve: (value: unknown) => void;
  reject: (error: HelperCallError) => void;
  cleanup: () => void;
}

export class HelperClient {
  readonly #write: (line: string) => void;
  readonly #pending = new Map<string, Pending>();
  readonly #newId: () => string;
  #buffer = '';
  #closed: string | null = null;
  #counter = 0;

  constructor(write: (line: string) => void, newId?: () => string) {
    this.#write = write;
    this.#newId = newId ?? (() => {
      this.#counter += 1;
      return `h${this.#counter}`;
    });
  }

  get inFlight(): number {
    return this.#pending.size;
  }

  call<M extends HelperMethod>(method: M, params: HelperParams<M>,
    options: HelperCallOptions = {}): Promise<HelperResult<M>> {
    if (this.#closed !== null) {
      return Promise.reject(new HelperCallError('closed', this.#closed));
    }
    if (method === 'cancel') {
      return Promise.reject(new HelperCallError('invalid_request', '取消用调用时的 AbortSignal，不直接发 cancel。'));
    }
    if (!Value.Check(HELPER_METHODS[method].params, params)) {
      return Promise.reject(new HelperCallError('invalid_params', `${method} 的参数不对，没有发给助手。`));
    }
    if (options.signal?.aborted === true) {
      return Promise.reject(new HelperCallError('cancelled', '已取消，没有发给助手。'));
    }
    const id = this.#newId();
    return new Promise<HelperResult<M>>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const onAbort = (): void => this.#abandon(id, new HelperCallError('cancelled', '已取消，可能已产生部分结果，请先核实。'));
      const cleanup = (): void => {
        if (timer !== null) {
          clearTimeout(timer);
        }
        options.signal?.removeEventListener('abort', onAbort);
      };
      this.#pending.set(id, { method, resolve: (value) => resolve(value as HelperResult<M>), reject, cleanup });
      options.signal?.addEventListener('abort', onAbort, { once: true });
      if (options.timeoutMs !== undefined) {
        timer = setTimeout(() => this.#abandon(id, new HelperCallError('timeout',
          `助手 ${options.timeoutMs} 毫秒没有回执，已让它取消；说不清做没做，请先核实。`)), options.timeoutMs);
      }
      this.#send({ id, method, params });
    });
  }

  /** 助手 stdout 的一块（可能半行、可能几行）。 */
  receive(chunk: string): void {
    this.#buffer += chunk;
    let end = this.#buffer.indexOf('\n');
    while (end >= 0) {
      const line = this.#buffer.slice(0, end).trim();
      this.#buffer = this.#buffer.slice(end + 1);
      if (line !== '') {
        this.#settle(line);
      }
      end = this.#buffer.indexOf('\n');
    }
  }

  /** 助手退出了：还在等的全部按 closed 交回，之后的调用直接拒。 */
  close(reason = '助手已经退出，这一步说不清做没做，请先核实。'): void {
    this.#closed = reason;
    for (const [id, pending] of this.#pending) {
      this.#pending.delete(id);
      pending.cleanup();
      pending.reject(new HelperCallError('closed', reason));
    }
  }

  #send(request: { id: string; method: string; params: unknown }): void {
    this.#write(`${JSON.stringify(request)}\n`);
  }

  /** 不再等这一次：交回错误，并让助手停下（它稍后回的 cancelled 会被丢掉）。 */
  #abandon(id: string, error: HelperCallError): void {
    const pending = this.#pending.get(id);
    if (pending === undefined) {
      return;
    }
    this.#pending.delete(id);
    pending.cleanup();
    pending.reject(error);
    if (this.#closed === null) {
      this.#send({ id: this.#newId(), method: 'cancel', params: { requestId: id } });
    }
  }

  #settle(line: string): void {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      if (error instanceof SyntaxError) {
        console.warn('助手回了一行不是 JSON 的内容，丢掉', line.slice(0, 200));
        return;
      }
      throw error;
    }
    if (!Value.Check(HelperResponseSchema, value)) {
      console.warn('助手的回执形状不对，丢掉', line.slice(0, 200));
      return;
    }
    if (value.id === null) {
      console.warn('助手说有一行请求读不懂', 'error' in value ? value.error.message : '');
      return;
    }
    const pending = this.#pending.get(value.id);
    if (pending === undefined) {
      // cancel 的回执、已经放弃的那一次的迟到回执。
      return;
    }
    this.#pending.delete(value.id);
    pending.cleanup();
    if ('error' in value) {
      pending.reject(new HelperCallError(value.error.code, value.error.message));
      return;
    }
    if (!Value.Check(HELPER_METHODS[pending.method].result, value.result)) {
      pending.reject(new HelperCallError('failed', `助手 ${pending.method} 的回执形状不对，说不清做没做，请先核实。`));
      return;
    }
    pending.resolve(value.result);
  }
}
