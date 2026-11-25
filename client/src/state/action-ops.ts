import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import { ApiError, errorText, isUncertain, NOT_RECEIVED_CODE } from '../api/errors.ts';
import {
  AnswerAskRequestSchema,
  ChangeSoulRequestSchema,
  AskAboutRequestSchema,
  DeferAskRequestSchema,
  SaveNoteRequestSchema,
  NoteFolderCommandSchema,
  UnlockNoteRequestSchema,
  UploadAttachmentMetaSchema,
  CreateMoneyDraftRequestSchema,
  EditMoneyDraftRequestSchema,
  ConfirmMoneyDraftRequestSchema,
  RejectMoneyDraftRequestSchema,
  CreateBackupRequestSchema, RestorePreviewRequestSchema, RestoreBackupRequestSchema,
} from '../api/shared.ts';
import { MATES_ACTION_REQUEST_SCHEMAS } from './mates-action-requests.ts';
import { CONTACTS_ACTION_REQUEST_SCHEMAS } from './contacts-action-requests.ts';
import { M4_ACTION_REQUEST_SCHEMAS } from './daily-action-requests.ts';
import { M5_ACTION_REQUEST_SCHEMAS } from './device-action-requests.ts';
import { TOOL_GROUP_ACTION_REQUEST_SCHEMAS } from './tool-group-action-requests.ts';
import type { KeyValueStorage } from './outbox.ts';
import { Store } from './store.ts';

export const ActionRequestSchema = Type.Union([
  Type.Object({ kind: Type.Literal('soul_change'), body: ChangeSoulRequestSchema }),
  Type.Object({ kind: Type.Literal('backup_create'), body: CreateBackupRequestSchema }),
  Type.Object({ kind: Type.Literal('backup_preview'), backupId: Type.String(), body: RestorePreviewRequestSchema }),
  Type.Object({ kind: Type.Literal('backup_restore'), backupId: Type.String(), body: RestoreBackupRequestSchema }),
  Type.Object({ kind: Type.Literal('money_draft_create'), body: CreateMoneyDraftRequestSchema }),
  Type.Object({ kind: Type.Literal('money_draft_edit'), draftId: Type.String(), body: EditMoneyDraftRequestSchema }),
  Type.Object({ kind: Type.Literal('money_draft_confirm'), draftId: Type.String(),
    body: ConfirmMoneyDraftRequestSchema }),
  Type.Object({ kind: Type.Literal('money_draft_reject'), draftId: Type.String(),
    body: RejectMoneyDraftRequestSchema }),
  Type.Object({ kind: Type.Literal('attachment_upload'), fileId: Type.String(), body: UploadAttachmentMetaSchema }),
  Type.Object({ kind: Type.Literal('note_save'), noteId: Type.String(), body: SaveNoteRequestSchema }),
  Type.Object({ kind: Type.Literal('note_folder'), body: NoteFolderCommandSchema }),
  Type.Object({ kind: Type.Literal('note_unlock'), noteId: Type.String(), body: UnlockNoteRequestSchema }),
  Type.Object({ kind: Type.Literal('ask_answer'), askId: Type.String(), body: AnswerAskRequestSchema }),
  Type.Object({ kind: Type.Literal('ask_defer'), askId: Type.String(), body: DeferAskRequestSchema }),
  Type.Object({ kind: Type.Literal('ask_about'), askId: Type.String(), body: AskAboutRequestSchema }),
  ...M4_ACTION_REQUEST_SCHEMAS,
  ...M5_ACTION_REQUEST_SCHEMAS,
  ...TOOL_GROUP_ACTION_REQUEST_SCHEMAS,
  ...CONTACTS_ACTION_REQUEST_SCHEMAS,
  ...MATES_ACTION_REQUEST_SCHEMAS,
]);
export type ActionRequest = Static<typeof ActionRequestSchema>;

const ActionOpSchema = Type.Object({
  key: Type.String({ minLength: 1 }),
  label: Type.String(),
  subject: Type.String(),
  scope: Type.Optional(Type.Literal('self')),
  request: ActionRequestSchema,
  status: Type.Union([
    Type.Literal('running'),
    Type.Literal('uncertain'),
    Type.Literal('unsent'),
    Type.Literal('failed'),
  ]),
  error: Type.Union([Type.String(), Type.Null()]),
  unresolved: Type.Boolean(),
});
export type ActionOp = Static<typeof ActionOpSchema>;

const STORED_VERSION = 2;
const StoredActionOpsSchema = Type.Object({
  version: Type.Literal(STORED_VERSION),
  ops: Type.Array(ActionOpSchema),
});

export const ACTION_OPS_STORAGE_KEY = 'plasticine.action-ops';

const RELOADED_WHILE_RUNNING = '页面重新载入时这个操作还在路上，尚未取得服务回执。结果待核实，点「再核实」。';
const SIGNED_OUT = '会话失效，这次没有执行。重新配对后点「重发」，用的还是同一个标识。';

export function isOpenOp(op: Pick<ActionOp, 'status'>): boolean {
  return op.status !== 'failed';
}

export function requestIdOf(request: ActionRequest): string {
  return request.body.requestId;
}

export function askOpKey(askId: string, action: 'answer' | 'defer' | 'ask'): string {
  return `ask:${askId}:${action}`;
}

const RETIRED_REQUESTS: ReadonlySet<string> = new Set(['memory_edit', 'memory_archive', 'inbox_reply',
  'inbox_read_all', 'inbox_settle', 'task_command', 'conversation_send', 'judgment_status', 'forecast_create',
  'forecast_p', 'forecast_outcome', 'improvement_settings', 'improvement_propose', 'cognition_write',
  'concern_create', 'concern_edit', 'concern_shelve', 'concern_close', 'concern_register', 'return_brief_read',
  'brief_item_seen', 'brief_item_difference', 'focus_start', 'focus_stop', 'reminder_add', 'reminder_remove',
  'telemetry_settings', 'artifact_create', 'artifact_version', 'artifact_verify', 'schedule_create',
  'schedule_change', 'task_feedback', 'self_rollback']);

function retired(op: unknown): boolean {
  if (typeof op !== 'object' || op === null || !('request' in op)) {
    return false;
  }
  const request: unknown = op.request;
  if (typeof request !== 'object' || request === null || !('kind' in request) || typeof request.kind !== 'string') {
    return false;
  }
  return RETIRED_REQUESTS.has(request.kind);
}

function withoutRetired(parsed: unknown): unknown {
  if (typeof parsed !== 'object' || parsed === null || !('ops' in parsed) || !Array.isArray(parsed.ops)) {
    return parsed;
  }
  const ops: unknown[] = parsed.ops;
  const kept = ops.filter((op) => !retired(op));
  if (kept.length !== ops.length) {
    console.info(`丢掉了 ${ops.length - kept.length} 个已经没有界面的没了结操作（旧记忆条目、站内信回复）`);
  }
  return { ...parsed, ops: kept };
}

function readStored(storage: KeyValueStorage | null): ActionOp[] {
  if (storage === null) {
    return [];
  }
  let parsed: unknown;
  try {
    const raw = storage.getItem(ACTION_OPS_STORAGE_KEY);
    if (raw === null) {
      return [];
    }
    parsed = JSON.parse(raw);
  } catch {
    console.warn('读不到上次留下的任务 / 卡操作（sessionStorage 不可用或不是 JSON），从空的开始');
    return [];
  }
  parsed = withoutRetired(parsed);
  if (!Value.Check(StoredActionOpsSchema, parsed)) {
    console.warn('上次留下的任务 / 卡操作格式不对，不用它');
    return [];
  }
  return parsed.ops.map((op) =>
    op.status === 'running' ? { ...op, status: 'uncertain', error: RELOADED_WHILE_RUNNING, unresolved: true } : op,
  );
}

export class ActionOps {
  readonly store: Store<readonly ActionOp[]>;
  private readonly storage: KeyValueStorage | null;

  constructor(storage: KeyValueStorage | null = null) {
    this.storage = storage;
    this.store = new Store<readonly ActionOp[]>(readStored(storage));
    this.store.subscribe(() => this.persist());
  }

  get(key: string): ActionOp | undefined {
    return this.store.get().find((op) => op.key === key);
  }

  withPrefix(prefix: string): ActionOp[] {
    return this.store.get().filter((op) => op.key.startsWith(prefix));
  }

  hasPending(): boolean {
    return this.store.get().some((op) => op.request.kind !== 'note_unlock' && isOpenOp(op));
  }

  markScope(key: string, scope: 'self'): void {
    const op = this.get(key);
    if (op !== undefined && op.scope !== scope) {
      this.put({ ...op, scope });
    }
  }

  begin(
    key: string,
    label: string,
    subject: string,
    build: (id: string) => ActionRequest,
    newId: () => string,
  ): ActionRequest {
    const previous = this.get(key);
    if (previous !== undefined && isOpenOp(previous)) {
      this.put({ ...previous, status: 'running', error: null });
      return previous.request;
    }
    const request = build(newId());
    this.put({ key, label, subject, request, status: 'running', error: null, unresolved: false });
    return request;
  }

  retry(key: string): ActionRequest | undefined {
    const previous = this.get(key);
    if (previous === undefined || previous.status === 'failed') {
      return undefined;
    }
    this.put({ ...previous, status: 'running', error: null });
    return previous.request;
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
    if (isUncertain(cause) || ((signedOut || notReceived) && previous.unresolved)) {
      this.put({ ...previous, status: 'uncertain', error, unresolved: true });
      return;
    }
    if (signedOut || notReceived) {
      this.put({ ...previous, status: 'unsent', error: signedOut ? SIGNED_OUT : error });
      return;
    }
    this.put({ ...previous, status: 'failed', error, unresolved: false });
  }

  private put(op: ActionOp): void {
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
        this.storage.removeItem(ACTION_OPS_STORAGE_KEY);
      } else {
        this.storage.setItem(ACTION_OPS_STORAGE_KEY, JSON.stringify({ version: STORED_VERSION, ops }));
      }
    } catch {
      console.warn('任务 / 卡操作没存进 sessionStorage（可能满了或被禁用），刷新页面会丢');
    }
  }
}
