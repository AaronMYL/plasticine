import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import { ApiError, errorText, isSignatureRefusal, isUncertain, NOT_RECEIVED_CODE } from '../api/errors.ts';
import { createRequestId } from '../api/request-id.ts';
import { SignedTargetSchema, type SignedTarget } from '../api/signed-targets.ts';
import type { KeyValueStorage } from './outbox.ts';
import { Store } from './store.ts';

const SignedOpSchema = Type.Object({
  key: Type.String({ minLength: 1 }),
  label: Type.String(),
  subject: Type.String(),
  target: SignedTargetSchema,
  requestId: Type.String({ minLength: 1 }),
  bodyText: Type.String({ minLength: 2 }),
  status: Type.Union([
    Type.Literal('running'),
    Type.Literal('uncertain'),
    Type.Literal('unsent'),
    Type.Literal('failed'),
  ]),
  error: Type.Union([Type.String(), Type.Null()]),
  unresolved: Type.Boolean(),
});
export type SignedOp = Static<typeof SignedOpSchema>;

const STORED_VERSION = 2;
const StoredSignedOpsSchema = Type.Object({ version: Type.Literal(STORED_VERSION), ops: Type.Array(SignedOpSchema) });

export const SIGNED_OPS_STORAGE_KEY = 'plasticine.signed-ops';

const RELOADED_WHILE_RUNNING = '页面重新载入时这个操作还在路上，尚未取得服务回执。结果待核实，点「再核实」。';
const SIGNED_OUT = '会话失效，这次没有执行。重新配对后点「重发」，用的还是同一个标识和同样的内容。';

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

  dismiss(key: string): void {
    const op = this.get(key);
    if (op !== undefined && (op.status === 'unsent' || op.status === 'failed') && !op.unresolved) {
      this.succeed(key);
    }
  }

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
