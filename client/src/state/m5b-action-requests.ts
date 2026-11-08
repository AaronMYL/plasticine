// M5 乙路的写操作在 action-ops 里存成什么样：记账、站内信、文件页、浏览器（2026-11-05 专注、提醒、成果、遥测删了）。请求体用 shared 里的 schema，
// 标识就在请求体里；回执丢了、401、切页、刷新之后原样再发（不按新输入重写，审查 88c54ec P1）。
// 操作 key 也是那件东西的草稿 key 的前缀（`money:new:add` 的字段草稿是 `money:new:<字段>`）。

import { Type } from 'typebox';
import {
  AddMoneyAccountRequestSchema,
  BrowserActionRequestSchema,
  CreateFolderRequestSchema,
  EditMoneyRequestSchema,
  MoveFileRequestSchema,
  OpenBrowserRequestSchema,
  RecordMoneyRequestSchema,
  RemoveMoneyRequestSchema,
  RestoreFileRequestSchema,
  SetInboxFlagsRequestSchema,
  SettleActionRequestSchema,
  TrashFileRequestSchema,
  UploadFileRequestSchema,
  WriteFileTextRequestSchema,
} from '../api/shared.ts';

const Id = Type.String();

export const M5B_ACTION_REQUEST_SCHEMAS = [
  Type.Object({ kind: Type.Literal('money_record'), body: RecordMoneyRequestSchema }),
  Type.Object({ kind: Type.Literal('money_edit'), entryId: Id, body: EditMoneyRequestSchema }),
  Type.Object({ kind: Type.Literal('money_remove'), entryId: Id, body: RemoveMoneyRequestSchema }),
  Type.Object({ kind: Type.Literal('money_account'), body: AddMoneyAccountRequestSchema }),
  Type.Object({ kind: Type.Literal('inbox_flags'), messageId: Id, body: SetInboxFlagsRequestSchema }),
  Type.Object({ kind: Type.Literal('files_upload'), body: UploadFileRequestSchema }),
  Type.Object({ kind: Type.Literal('files_text'), body: WriteFileTextRequestSchema }),
  Type.Object({ kind: Type.Literal('files_folder'), body: CreateFolderRequestSchema }),
  Type.Object({ kind: Type.Literal('files_move'), body: MoveFileRequestSchema }),
  Type.Object({ kind: Type.Literal('files_trash'), body: TrashFileRequestSchema }),
  Type.Object({ kind: Type.Literal('files_restore'), body: RestoreFileRequestSchema }),
  Type.Object({ kind: Type.Literal('browser_open'), body: OpenBrowserRequestSchema }),
  Type.Object({ kind: Type.Literal('browser_act'), body: BrowserActionRequestSchema }),
  Type.Object({ kind: Type.Literal('browser_settle'), actionRequestId: Id, body: SettleActionRequestSchema }),
] as const;

export const MONEY_ADD_OP_KEY = 'money:new:add';

export function moneyEntryOpKey(entryId: string, action: 'edit' | 'remove'): string {
  return `money:${entryId}:${action}`;
}

export const MONEY_ACCOUNT_OP_KEY = 'money:account:add';
export function inboxOpKey(messageId: string, action: 'read' | 'star' | 'archive'): string {
  return `inbox:${messageId}:${action}`;
}

export function filesOpKey(action: 'upload' | 'folder' | 'move' | 'trash' | 'restore', target: string): string {
  return `files:${action}:${target}`;
}

export const BROWSER_OPEN_OP_KEY = 'browser:open';
export const BROWSER_ACT_OP_KEY = 'browser:act';
