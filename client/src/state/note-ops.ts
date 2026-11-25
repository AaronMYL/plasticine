import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { ApiError, errorText, isUncertain } from '../api/errors.ts';
import type { KeyValueStorage } from './outbox.ts';
import { Store } from './store.ts';

export type NoteOpStatus = 'running' | 'uncertain' | 'failed';

export interface NoteOp {
  requestId: string;
  status: NoteOpStatus;
  error: string | null;
  unresolved: boolean;
}

export const CREATE_NOTE_OP = 'create';

export function deleteNoteOp(noteId: string): string {
  return `delete:${noteId}`;
}

export function restoreNoteOp(noteId: string): string {
  return `restore:${noteId}`;
}

export const NOTE_OPS_STORAGE_KEY = 'plasticine.note-ops';

const RELOADED_WHILE_RUNNING = '页面重新载入时这个操作还在路上，尚未取得服务回执。结果待核实，点「再核实」。';

const NoteOpSchema = Type.Object({
  key: Type.String({ minLength: 1 }),
  requestId: Type.String({ minLength: 1 }),
  status: Type.Union([Type.Literal('running'), Type.Literal('uncertain'), Type.Literal('failed')]),
  error: Type.Union([Type.String(), Type.Null()]),
  unresolved: Type.Boolean(),
});
const StoredNoteOpsSchema = Type.Object({ version: Type.Literal(1), ops: Type.Array(NoteOpSchema) });

function readStored(storage: KeyValueStorage | null): Map<string, NoteOp> {
  const ops = new Map<string, NoteOp>();
  if (storage === null) {
    return ops;
  }
  let parsed: unknown;
  try {
    const raw = storage.getItem(NOTE_OPS_STORAGE_KEY);
    if (raw === null) {
      return ops;
    }
    parsed = JSON.parse(raw);
  } catch (error) {
    console.warn('读不到上次留下的笔记操作（sessionStorage 不可用或不是 JSON），从空的开始', error);
    return ops;
  }
  if (!Value.Check(StoredNoteOpsSchema, parsed)) {
    console.warn('上次留下的笔记操作格式不对，不用它');
    return ops;
  }
  for (const { key, ...op } of parsed.ops) {
    const running = op.status === 'running';
    ops.set(key, running ? { ...op, status: 'uncertain', error: RELOADED_WHILE_RUNNING, unresolved: true } : op);
  }
  return ops;
}

export class NoteOps {
  readonly store: Store<ReadonlyMap<string, NoteOp>>;
  private readonly storage: KeyValueStorage | null;

  constructor(storage: KeyValueStorage | null = null) {
    this.storage = storage;
    this.store = new Store<ReadonlyMap<string, NoteOp>>(readStored(storage));
    this.store.subscribe(() => this.persist());
  }

  get(key: string): NoteOp | undefined {
    return this.store.get().get(key);
  }

  hasPending(): boolean {
    return [...this.store.get().values()].some((op) => op.status !== 'failed');
  }

  begin(key: string, newRequestId: () => string): string {
    const previous = this.get(key);
    const reuse = previous !== undefined && previous.status !== 'failed';
    const requestId = reuse ? previous.requestId : newRequestId();
    const unresolved = reuse ? previous.unresolved : false;
    this.put(key, { requestId, status: 'running', error: null, unresolved });
    return requestId;
  }

  succeed(key: string): void {
    this.store.set((ops) => {
      if (!ops.has(key)) {
        return ops;
      }
      const next = new Map(ops);
      next.delete(key);
      return next;
    });
  }

  fail(key: string, cause: unknown): void {
    const previous = this.get(key);
    if (previous === undefined) {
      return;
    }
    const error = errorText(cause);
    const notAnAnswer = cause instanceof ApiError && cause.kind === 'unauthorized';
    if (isUncertain(cause) || (notAnAnswer && previous.unresolved)) {
      this.put(key, { ...previous, status: 'uncertain', error, unresolved: true });
      return;
    }
    this.put(key, { ...previous, status: 'failed', error });
  }

  private put(key: string, op: NoteOp): void {
    this.store.set((ops) => {
      const next = new Map(ops);
      next.set(key, op);
      return next;
    });
  }

  private persist(): void {
    if (this.storage === null) {
      return;
    }
    const ops = [...this.store.get()].map(([key, op]) => ({ key, ...op }));
    try {
      if (ops.length === 0) {
        this.storage.removeItem(NOTE_OPS_STORAGE_KEY);
      } else {
        this.storage.setItem(NOTE_OPS_STORAGE_KEY, JSON.stringify({ version: 1, ops }));
      }
    } catch (error) {
      console.warn('笔记操作没存进 sessionStorage（可能满了或被禁用），刷新页面会丢', error);
    }
  }
}
