// 要你定卡的写操作（作答、先不、问一句）和其余普通写操作各带一个标识 requestId（约定 1）；单独跟踪的本人确认操作在
// signed-ops.ts。2026-11-05 任务命令、判断、预测、改进发现、旧对话发送这几种随功能删了。
// 标识和整个请求体存在这里，不存在组件里：回执丢了（超时、断网）、401 重新配对、切页、刷新这个标签页之后，
// 同一次点击的重试用的还是同一个标识，服务端对同一标识回同一个结果，不会暂停两次、答两次。
// 和待发记录、笔记操作一样另存一份进 sessionStorage；还没了结的也算进离开页面前的提醒。

import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import { ApiError, errorText, isUncertain, NOT_RECEIVED_CODE } from '../api/errors.ts';
import {
  AnswerAskRequestSchema,
  AskAboutRequestSchema,
  DeferAskRequestSchema,
  SaveNoteRequestSchema,
  NoteFolderCommandSchema,
  UnlockNoteRequestSchema,
  CreateTermRequestSchema,
  ProposeTermRequestSchema,
  ConfirmAgreementRequestSchema,
  UploadAttachmentMetaSchema,
  CreateMoneyDraftRequestSchema,
  EditMoneyDraftRequestSchema,
  ConfirmMoneyDraftRequestSchema,
  RejectMoneyDraftRequestSchema,
  ClientUpdateDecisionSchema,
  CreateBackupRequestSchema, RestorePreviewRequestSchema, RestoreBackupRequestSchema,
} from '../api/shared.ts';
import { MATES_ACTION_REQUEST_SCHEMAS } from './mates-action-requests.ts';
import { CONTACTS_ACTION_REQUEST_SCHEMAS } from './contacts-action-requests.ts';
import { M4_ACTION_REQUEST_SCHEMAS } from './m4-action-requests.ts';
import { M5_ACTION_REQUEST_SCHEMAS } from './m5-action-requests.ts';
import { M5B_ACTION_REQUEST_SCHEMAS } from './m5b-action-requests.ts';
import type { KeyValueStorage } from './outbox.ts';
import { Store } from './store.ts';

/** 一个写操作要发的东西：发往哪（任务 / 卡 / …）和请求体（里面带着标识）。M4、M5 的几种在 m4- / m5-action-requests.ts。 */
export const ActionRequestSchema = Type.Union([
  Type.Object({ kind: Type.Literal('backup_create'), body: CreateBackupRequestSchema }),
  Type.Object({ kind: Type.Literal('backup_preview'), backupId: Type.String(), body: RestorePreviewRequestSchema }),
  Type.Object({ kind: Type.Literal('backup_restore'), backupId: Type.String(), body: RestoreBackupRequestSchema }),
  Type.Object({ kind: Type.Literal('client_update_decision'), buildId: Type.String(),
    body: ClientUpdateDecisionSchema }),
  Type.Object({ kind: Type.Literal('money_draft_create'), body: CreateMoneyDraftRequestSchema }),
  Type.Object({ kind: Type.Literal('money_draft_edit'), draftId: Type.String(), body: EditMoneyDraftRequestSchema }),
  Type.Object({ kind: Type.Literal('money_draft_confirm'), draftId: Type.String(),
    body: ConfirmMoneyDraftRequestSchema }),
  Type.Object({ kind: Type.Literal('money_draft_reject'), draftId: Type.String(),
    body: RejectMoneyDraftRequestSchema }),
  Type.Object({ kind: Type.Literal('attachment_upload'), fileId: Type.String(), body: UploadAttachmentMetaSchema }),
  Type.Object({ kind: Type.Literal('term_create'), body: CreateTermRequestSchema }),
  Type.Object({ kind: Type.Literal('term_propose'), termId: Type.String(), body: ProposeTermRequestSchema }),
  Type.Object({ kind: Type.Literal('term_confirm'), termId: Type.String(), body: ConfirmAgreementRequestSchema }),
  Type.Object({ kind: Type.Literal('note_save'), noteId: Type.String(), body: SaveNoteRequestSchema }),
  Type.Object({ kind: Type.Literal('note_folder'), body: NoteFolderCommandSchema }),
  Type.Object({ kind: Type.Literal('note_unlock'), noteId: Type.String(), body: UnlockNoteRequestSchema }),
  Type.Object({ kind: Type.Literal('ask_answer'), askId: Type.String(), body: AnswerAskRequestSchema }),
  Type.Object({ kind: Type.Literal('ask_defer'), askId: Type.String(), body: DeferAskRequestSchema }),
  Type.Object({ kind: Type.Literal('ask_about'), askId: Type.String(), body: AskAboutRequestSchema }),
  ...M4_ACTION_REQUEST_SCHEMAS,
  ...M5_ACTION_REQUEST_SCHEMAS,
  ...M5B_ACTION_REQUEST_SCHEMAS,
  ...CONTACTS_ACTION_REQUEST_SCHEMAS,
  ...MATES_ACTION_REQUEST_SCHEMAS,
]);
export type ActionRequest = Static<typeof ActionRequestSchema>;

/**
 * running 请求在路上 · uncertain 回执不确定（结果待核实，用同一标识再发一次就是核实）· unsent 确定没送到
 * （会话失效、服务正在重启），可以用同一标识重发 · failed 服务端明确拒了（文案是服务端那句），下次点换新标识。
 */
export type ActionStatus = 'running' | 'uncertain' | 'unsent' | 'failed';

const ActionOpSchema = Type.Object({
  key: Type.String({ minLength: 1 }),
  /** 按钮上的字（「暂停」「作答」），状态那一行用。 */
  label: Type.String(),
  /** 对着哪一件（任务的标题、卡上那一句）：那一件不在清单里了，任务页顶上的核实列表靠它写明是哪个。 */
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
  /** 这个标识有一次回执不确定过：直到服务端对它给出明确回答之前，都不能换标识。 */
  unresolved: Type.Boolean(),
});
export type ActionOp = Static<typeof ActionOpSchema>;

// 第 2 版加了 subject；第 1 版（88c54ec）只在开发里出现过，读到就当格式不对。
const STORED_VERSION = 2;
const StoredActionOpsSchema = Type.Object({
  version: Type.Literal(STORED_VERSION),
  ops: Type.Array(ActionOpSchema),
});

export const ACTION_OPS_STORAGE_KEY = 'plasticine.action-ops';

const RELOADED_WHILE_RUNNING = '页面重新载入时这个操作还在路上，尚未取得服务回执。结果待核实，点「再核实」。';
const SIGNED_OUT = '会话失效，这次没有执行。重新配对后点「重发」，用的还是同一个标识。';

/** 还没了结：在路上、待核实或没送到。被拒的（failed）已经有了服务端的回答，算了结。 */
export function isOpenOp(op: Pick<ActionOp, 'status'>): boolean {
  return op.status !== 'failed';
}

/** 一个操作的标识在请求体里的哪个字段。 */
export function requestIdOf(request: ActionRequest): string {
  return request.body.requestId;
}

export function askOpKey(askId: string, action: 'answer' | 'defer' | 'ask'): string {
  return `ask:${askId}:${action}`;
}

/**
 * 接口已删、再发只会失败的几种：2026-11-03 去掉的旧记忆条目写操作；第 113 条去掉站内信页后的站内信回复、全部标已读、
 * 核实回复；2026-11-05 Harness 重做删掉的任务命令、旧对话发送、判断、预测、改进发现、认知页写入、关切、回来汇报、
 * 十件事、专注、提醒、遥测、成果、定时任务、自迭代回退。本机还留着的这几种不再恢复。
 */
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

/** 本机存着的没了结操作里去掉已经没有的那几种（数据跟着升级），其余照常恢复。 */
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
  // 刷新前还在路上的：那次请求的结果不知道，算回执不确定，沿用原标识核实。
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

  /** 以 prefix 开头的那些（一项任务的、一张卡的）。 */
  withPrefix(prefix: string): ActionOp[] {
    return this.store.get().filter((op) => op.key.startsWith(prefix));
  }

  /** 还有在路上、待核实或没送到的：离开页面前要问一句。 */
  hasPending(): boolean {
    // 旧解锁记录留着兼容；读取已不依赖它，不再阻止离开或刷新。
    return this.store.get().some((op) => op.request.kind !== 'note_unlock' && isOpenOp(op));
  }

  /** 卡可能先从记录中收起；操作本身记住归属，刷新后仍有核实入口。 */
  markScope(key: string, scope: 'self'): void {
    const op = this.get(key);
    if (op !== undefined && op.scope !== scope) {
      this.put({ ...op, scope });
    }
  }

  /**
   * 开始一次操作。上一次还没了结（在路上、待核实、没送到）：原样再发上一次存下的请求，不按这次的输入重写——
   * 服务端对同一标识回第一次的结果，换了内容也只会被丢掉（审查 88c54ec P1）。界面在没了结时不让输入新内容。
   * 上一次被明确拒了：服务端记下的就是那句拒绝，这次按新输入、换新标识。返回这次要发的请求。
   */
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

  /** 再核实 / 重发：原样再发一次存下的请求（同一标识）。没有这条就返回 undefined。 */
  retry(key: string): ActionRequest | undefined {
    const previous = this.get(key);
    if (previous === undefined || previous.status === 'failed') {
      return undefined;
    }
    this.put({ ...previous, status: 'running', error: null });
    return previous.request;
  }

  /** 拿到了结果：了结，标识不再用。 */
  succeed(key: string): void {
    this.store.set((ops) => (ops.some((op) => op.key === key) ? ops.filter((op) => op.key !== key) : ops));
  }

  /** 不发了 / 知道了：只给没送到和被拒的用；待核实的可能已经生效，不让丢。 */
  dismiss(key: string): void {
    const op = this.get(key);
    if (op !== undefined && (op.status === 'unsent' || op.status === 'failed') && !op.unresolved) {
      this.succeed(key);
    }
  }

  /**
   * 这次尝试没拿到结果：
   * - 回执不确定 → 待核实，沿用标识；
   * - 401（服务端在看标识之前就挡下了）和 503 shutting_down（明说没收下）不是对这个操作的回答：之前待核实过的
   *   仍待核实，否则是「没送到」，都沿用原标识；
   * - 其余是服务端的明确回答（409 状态机不许、卡已答 …）：被拒，文案用服务端的，下次点换新标识。
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
      // 内存里的标识还在、照常能核实；只是刷新页面会丢，离开前的提醒照样会问。
      console.warn('任务 / 卡操作没存进 sessionStorage（可能满了或被禁用），刷新页面会丢');
    }
  }
}
