import { Type } from 'typebox';
import { Value } from 'typebox/value';
import type { Quote } from '../api/types.ts';
import { AttachmentViewSchema, BookQuoteReferenceSchema, NoteQuoteReferenceSchema, SpaceQuoteReferenceSchema,
  type AttachmentView } from '../api/shared.ts';
import { Store } from './store.ts';

export type PendingStatus = 'sending' | 'uncertain' | 'unsent' | 'failed';

export interface PendingSend {
  chatId?: string;
  control?: 'foreground_stop';
  resumeRunId?: string;
  attachments?: AttachmentView[];
  requestId: string;
  text: string;
  quotes: Quote[];
  status: PendingStatus;
  error: string | null;
}

export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const OUTBOX_STORAGE_KEY = 'plasticine.outbox';

const RELOADED_WHILE_SENDING = '页面重新载入时这一条还在发送中，尚未取得服务回执。结果待核实，点「再核实」。';

export const QuoteSchema = Type.Object({
  id: Type.String(),
  kind: Type.Enum(['note', 'book', 'space', 'message', 'object']),
  sourceId: Type.String(),
  label: Type.String(),
  text: Type.String(),
  noteReference: Type.Optional(NoteQuoteReferenceSchema),
  bookReference: Type.Optional(BookQuoteReferenceSchema),
  spaceReference: Type.Optional(SpaceQuoteReferenceSchema),
});

const PendingSendSchema = Type.Object({
  chatId: Type.Optional(Type.String({ minLength: 1 })),
  control: Type.Optional(Type.Literal('foreground_stop')),
  resumeRunId: Type.Optional(Type.String()),
  attachments: Type.Optional(Type.Array(AttachmentViewSchema)),
  requestId: Type.String({ minLength: 1 }),
  text: Type.String(),
  quotes: Type.Array(QuoteSchema),
  status: Type.Union([
    Type.Literal('sending'),
    Type.Literal('uncertain'),
    Type.Literal('unsent'),
    Type.Literal('failed'),
  ]),
  error: Type.Union([Type.String(), Type.Null()]),
});

const StoredOutboxSchema = Type.Object({ version: Type.Literal(1), pending: Type.Array(PendingSendSchema) });

function afterReload(pending: PendingSend): PendingSend {
  if (pending.status !== 'sending') {
    return pending;
  }
  return { ...pending, status: 'uncertain', error: RELOADED_WHILE_SENDING };
}

function readStored(storage: KeyValueStorage | null): PendingSend[] {
  if (storage === null) {
    return [];
  }
  let raw: string | null;
  try {
    raw = storage.getItem(OUTBOX_STORAGE_KEY);
  } catch (error) {
    console.warn('读不到上次留下的待发记录（sessionStorage 不可用），从空的开始', error);
    return [];
  }
  if (raw === null) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.warn('上次留下的待发记录不是 JSON，不用它', error);
    return [];
  }
  if (!Value.Check(StoredOutboxSchema, parsed)) {
    console.warn('上次留下的待发记录格式不对，不用它');
    return [];
  }
  return parsed.pending.map(afterReload);
}

export class Outbox {
  readonly store: Store<readonly PendingSend[]>;
  private readonly storage: KeyValueStorage | null;

  constructor(storage: KeyValueStorage | null = null) {
    this.storage = storage;
    this.store = new Store<readonly PendingSend[]>(readStored(storage));
    this.store.subscribe(() => this.persist());
  }

  find(requestId: string): PendingSend | undefined {
    return this.store.get().find((pending) => pending.requestId === requestId);
  }

  add(pending: PendingSend): void {
    this.store.set((list) => [...list.filter((item) => item.requestId !== pending.requestId), pending]);
  }

  update(requestId: string, patch: Partial<Pick<PendingSend, 'status' | 'error'>>): void {
    this.store.set((list) => {
      if (!list.some((pending) => pending.requestId === requestId)) {
        return list;
      }
      return list.map((pending) => (pending.requestId === requestId ? { ...pending, ...patch } : pending));
    });
  }

  remove(requestId: string): PendingSend | undefined {
    const pending = this.find(requestId);
    if (pending !== undefined) {
      this.store.set((list) => list.filter((item) => item.requestId !== requestId));
    }
    return pending;
  }

  confirm(requestIds: Iterable<string | null>): void {
    const stored = new Set(requestIds);
    this.store.set((list) => {
      const left = list.filter((pending) => !stored.has(pending.requestId));
      return left.length === list.length ? list : left;
    });
  }

  hasAny(): boolean {
    return this.store.get().length > 0;
  }

  private persist(): void {
    if (this.storage === null) {
      return;
    }
    const pending = this.store.get();
    try {
      if (pending.length === 0) {
        this.storage.removeItem(OUTBOX_STORAGE_KEY);
      } else {
        this.storage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify({ version: 1, pending }));
      }
    } catch (error) {
      console.warn('待发记录没存进 sessionStorage（可能满了或被禁用），刷新页面会丢', error);
    }
  }
}
