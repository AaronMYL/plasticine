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

export const TOOL_GROUP_ACTION_REQUEST_SCHEMAS = [
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
