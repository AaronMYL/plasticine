// 本人确认的写操作（授权、确认 / 撤约定等）各带一个 requestId（约定 1）。标识连同原样的请求体存在这里，
// 不存在组件里：回执丢了、401 重新配对、切页、刷新这个标签页之后，同一次点击的重试发的还是同一个标识、一字不差的
// 请求体——服务端按请求体摘要去重，内容不同的同一标识会被拒。发送时不附带签名，确认身份由当前本人会话给出。
// 和 action-ops.ts 一个写法，另存一份进 sessionStorage；里面只有标识和请求体，没有钥匙。

import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import { ApiError, errorText, isSignatureRefusal, isUncertain, NOT_RECEIVED_CODE } from '../api/errors.ts';
import { createRequestId } from '../api/request-id.ts';
import { SignedTargetSchema, type SignedTarget } from '../api/signed-targets.ts';
import type { KeyValueStorage } from './outbox.ts';
import { Store } from './store.ts';

/**
 * running 在路上 · uncertain 回执不确定（保留原标识查询回执）· unsent 确定没执行（会话失效、
 * 服务正在重启或旧接口明确拒绝），可以用同一标识重发 · failed 服务端明确拒了，下次点换新标识。
 */
export type SignedOpStatus = 'running' | 'uncertain' | 'unsent' | 'failed';

const SignedOpSchema = Type.Object({
  key: Type.String({ minLength: 1 }),
  /** 状态那一行写的：「把 p 改成 0.40」「确认这条约定」。 */
  label: Type.String(),
  /** 对着哪一件（判断的命题、约定的标题）：那一件不在眼前了，页顶的核实列表靠它写明是哪个。 */
  subject: Type.String(),
  target: SignedTargetSchema,
  requestId: Type.String({ minLength: 1 }),
  /** 原样的请求体：发送、重试与服务端去重均使用它。 */
  bodyText: Type.String({ minLength: 2 }),
  status: Type.Union([
    Type.Literal('running'),
    Type.Literal('uncertain'),
    Type.Literal('unsent'),
    Type.Literal('failed'),
  ]),
  error: Type.Union([Type.String(), Type.Null()]),
  /** 这个标识有一次回执不确定过：服务端对它给出明确回答之前不换标识，也不让「不发了」。 */
  unresolved: Type.Boolean(),
});
export type SignedOp = Static<typeof SignedOpSchema>;

// 第 2 版加了 subject；第 1 版（5087993）没上线过，读到就当格式不对。
const STORED_VERSION = 2;
const StoredSignedOpsSchema = Type.Object({ version: Type.Literal(STORED_VERSION), ops: Type.Array(SignedOpSchema) });

export const SIGNED_OPS_STORAGE_KEY = 'plasticine.signed-ops';

const RELOADED_WHILE_RUNNING = '页面重新载入时这个操作还在路上，尚未取得服务回执。结果待核实，点「再核实」。';
const SIGNED_OUT = '会话失效，这次没有执行。重新配对后点「重发」，用的还是同一个标识和同样的内容。';

export function judgmentOpKey(judgmentId: string, action: 'p' | 'outcome'): string {
  return `judgment:${judgmentId}:${action}`;
}

export function agreementOpKey(agreementId: string): string {
  return `agreement:${agreementId}:confirm`;
}

function readStored(storage: KeyValueStorage | null): SignedOp[] {
  if (storage === null) {
    return [];
  }
  let parsed: unknown;
  try {
    const raw = storage.getItem(SIGNED_OPS_STORAGE_KEY);
    if (raw === null) {
      return [];
    }
    parsed = JSON.parse(raw);
  } catch (error) {
    console.warn('读不到上次留下的确认操作（sessionStorage 不可用或不是 JSON），从空的开始', error);
    return [];
  }
  if (!Value.Check(StoredSignedOpsSchema, parsed)) {
    console.warn('上次留下的确认操作格式不对，不用它');
    return [];
  }
  return parsed.ops.map((op) =>
    op.status === 'running' ? { ...op, status: 'uncertain', error: RELOADED_WHILE_RUNNING, unresolved: true } : op,
  );
}

export class SignedOps {
  readonly store: Store<readonly SignedOp[]>;
  private readonly storage: KeyValueStorage | null;

  constructor(storage: KeyValueStorage | null = null) {
    this.storage = storage;
    this.store = new Store<readonly SignedOp[]>(readStored(storage));
    this.store.subscribe(() => this.persist());
  }

  get(key: string): SignedOp | undefined {
    return this.store.get().find((op) => op.key === key);
  }

  withPrefix(prefix: string): SignedOp[] {
    return this.store.get().filter((op) => op.key.startsWith(prefix));
  }

  hasPending(): boolean {
    return this.store.get().some((op) => op.target.kind !== 'note_unlock' && op.status !== 'failed');
  }

  /**
   * 开始一次：上一次还没了结（在路上、待核实、没送到）就把上一次原样再来一遍——同一个标识只能配同一个请求体，
   * 这次填的新内容等上一次了结了再发；上一次被明确拒了，换新标识按这次的内容写。返回这次要发的。
   */
  begin(
    key: string,
    label: string,
    subject: string,
    target: SignedTarget,
    build: (requestId: string) => object,
  ): SignedOp {
    const previous = this.get(key);
    if (previous !== undefined && previous.status !== 'failed') {
      const again: SignedOp = { ...previous, status: 'running', error: null };
      this.put(again);
      return again;
    }
    const requestId = createRequestId();
    const op: SignedOp = {
      key,
      label,
      subject,
      target,
      requestId,
      bodyText: JSON.stringify(build(requestId)),
      status: 'running',
      error: null,
      unresolved: false,
    };
    this.put(op);
    return op;
  }

  /** 再核实 / 重发：存下的原样再发一次（调用方重签）。 */
  retry(key: string): SignedOp | undefined {
    const previous = this.get(key);
    if (previous === undefined || previous.status === 'failed') {
      return undefined;
    }
    const again: SignedOp = { ...previous, status: 'running', error: null };
    this.put(again);
    return again;
  }

  succeed(key: string): void {
    this.store.set((ops) => (ops.some((op) => op.key === key) ? ops.filter((op) => op.key !== key) : ops));
  }

  /** 不发了 / 知道了：只给没送到和被拒的；待核实过的可能已经生效，不让丢。 */
  dismiss(key: string): void {
    const op = this.get(key);
    if (op !== undefined && (op.status === 'unsent' || op.status === 'failed') && !op.unresolved) {
      this.succeed(key);
    }
  }

  /**
   * 这次没拿到结果：回执不确定 → 待核实；401、503 shutting_down、旧接口的签名被拒（403）都是服务端在执行之前就挡下了，
   * 不是对这个操作的回答——待核实过的仍待核实，否则「没送到」，都沿用标识；其余是明确的拒绝，下次换新标识。
   */
  fail(key: string, cause: unknown): void {
    const previous = this.get(key);
    if (previous === undefined) {
      return;
    }
    const error = errorText(cause);
    if (cause instanceof ApiError && cause.code === 'result_not_found') {
      this.put({ ...previous, status: 'unsent', error, unresolved: false });
      return;
    }
    const lookupRefused = cause instanceof ApiError
      && (cause.code === 'result_expired' || cause.code === 'result_scope_mismatch');
    if (lookupRefused && previous.unresolved) {
      this.put({ ...previous, status: 'uncertain', error, unresolved: true });
      return;
    }
    const signedOut = cause instanceof ApiError && cause.kind === 'unauthorized';
    const notReceived = cause instanceof ApiError && cause.code === NOT_RECEIVED_CODE;
    const notExecuted = signedOut || notReceived || isSignatureRefusal(cause);
    if (isUncertain(cause) || (notExecuted && previous.unresolved)) {
      this.put({ ...previous, status: 'uncertain', error, unresolved: true });
      return;
    }
    if (notExecuted) {
      this.put({ ...previous, status: 'unsent', error: signedOut ? SIGNED_OUT : error });
      return;
    }
    this.put({ ...previous, status: 'failed', error, unresolved: false });
  }

  private put(op: SignedOp): void {
    this.store.set((ops) => {
      const index = ops.findIndex((existing) => existing.key === op.key);
      if (index < 0) {
        return [...ops, op];
      }
      const next = [...ops];
      next[index] = op;
      return next;
    });
  }

  private persist(): void {
    if (this.storage === null) {
      return;
    }
    const ops = this.store.get();
    try {
      if (ops.length === 0) {
        this.storage.removeItem(SIGNED_OPS_STORAGE_KEY);
      } else {
        this.storage.setItem(SIGNED_OPS_STORAGE_KEY, JSON.stringify({ version: STORED_VERSION, ops }));
      }
    } catch (error) {
      console.warn('确认操作没存进 sessionStorage（可能满了或被禁用），刷新页面会丢', error);
    }
  }
}
