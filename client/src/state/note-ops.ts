// 笔记的新建、删除和恢复各带一个 request_id（约定 1）。标识存在这里，不存在组件里：回执丢了（超时、断网）时，
// 再点一次、切走再回来、重新配对、刷新这个标签页之后，用的还是同一个标识，服务端按它去重，不会建出第二篇。
// 和待发记录（outbox.ts）一样另存一份进 sessionStorage；还没了结的操作也算进离开页面前的提醒。

import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { ApiError, errorText, isUncertain } from '../api/errors.ts';
import type { KeyValueStorage } from './outbox.ts';
import { Store } from './store.ts';

/** running 请求在路上 · uncertain 回执不确定，下次沿用同一标识 · failed 明确失败，下次换新标识。 */
export type NoteOpStatus = 'running' | 'uncertain' | 'failed';

export interface NoteOp {
  requestId: string;
  status: NoteOpStatus;
  error: string | null;
  /** 这个标识有一次回执不确定过：那次可能已经落地，直到服务端对这个标识给出明确回答之前都不能换标识。 */
  unresolved: boolean;
}

/** 新建只有一个：没核实清楚的那一次没了结之前，再点「新建」就是重试它。 */
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
    // 刷新前还在路上的：那次请求的结果不知道，算回执不确定，沿用原标识核实。
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

  /** 还有在路上或待核实的操作：离开页面前要问一句，不然刷新后这些标识可能核实不到。 */
  hasPending(): boolean {
    return [...this.store.get().values()].some((op) => op.status !== 'failed');
  }

  /**
   * 开始一次操作，返回这次用的 request_id：上一次还在路上或回执不确定就沿用它（同一个操作的重试）；
   * 上一次明确失败了，服务端记下的就是那个失败回答，换新的标识才会真的再做一次。
   */
  begin(key: string, newRequestId: () => string): string {
    const previous = this.get(key);
    const reuse = previous !== undefined && previous.status !== 'failed';
    const requestId = reuse ? previous.requestId : newRequestId();
    const unresolved = reuse ? previous.unresolved : false;
    this.put(key, { requestId, status: 'running', error: null, unresolved });
    return requestId;
  }

  /** 拿到了结果：这个操作了结，标识不再用。 */
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

  /**
   * 这次尝试没拿到结果。回执不确定 → 待核实。会话失效（401）是在服务端看这个标识之前就挡下的，不是对这个操作的
   * 回答：之前有一次待核实过的，仍保持待核实、沿用原标识，重新配对后再核实；其余的明确失败，下次换新标识。
   */
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
      // 内存里的标识还在、照常能核实；只是刷新页面会丢，离开前的提醒照样会问。
      console.warn('笔记操作没存进 sessionStorage（可能满了或被禁用），刷新页面会丢', error);
    }
  }
}
