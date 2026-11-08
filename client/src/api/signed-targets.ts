// 本人会话确认的写操作。沿用既有目标和请求标识，不再依赖浏览器签名钥匙；真实现与假实现共用发送路径。

import { Type, type Static } from 'typebox';
import {
  AGREEMENTS_PATH,
  NODE_PAIRING_CODES_PATH,
  NODES_PATH,
  TOOL_GROUPS_PATH,
  NOTES_PATH,
  MONEY_DRAFTS_PATH,
  MEMORY_UNCERTAIN_PATH,
  type MoneyDraftView,
  type UncertainItem,
  type RestorePreview,
  type ToolGroupView,
} from './shared.ts';
import type { AgreementView, NodePairingCodeResponse, NodeView } from './types.ts';
import type { AnswerAskResponse } from './shared.ts';

export const SignedTargetSchema = Type.Union([
  Type.Object({ kind: Type.Literal('device_action_answer'), askId: Type.String({ minLength: 1 }) }),
  Type.Object({ kind: Type.Literal('backup_restore'), backupId: Type.String({ minLength: 1 }) }),
  Type.Object({ kind: Type.Literal('money_draft_confirm'), draftId: Type.String({ minLength: 1 }) }),
  Type.Object({ kind: Type.Literal('note_unlock'), noteId: Type.String({ minLength: 1 }) }),
  Type.Object({ kind: Type.Literal('agreement_confirm'), agreementId: Type.String({ minLength: 1 }) }),
  Type.Object({ kind: Type.Literal('agreement_edit'), agreementId: Type.String({ minLength: 1 }) }),
  Type.Object({ kind: Type.Literal('node_pairing_code') }),
  Type.Object({ kind: Type.Literal('node_limits'), nodeId: Type.String({ minLength: 1 }) }),
  // M5 乙路：工具组的开关是用户确认字段。
  Type.Object({ kind: Type.Literal('tool_group'), groupId: Type.String({ minLength: 1 }) }),
  // 第 102 条：拿不准的一条，用户说对 / 不对是用户确认字段。
  Type.Object({ kind: Type.Literal('memory_uncertain'), uncertainId: Type.String({ minLength: 1 }) }),
]);
export type SignedTarget = Static<typeof SignedTargetSchema>;

/** 都是 POST（服务端 router.ts）。 */
export const SIGNED_METHOD = 'POST';

export function signedPath(target: SignedTarget): string {
  switch (target.kind) {
    case 'device_action_answer': return `/v2/asks/${encodeURIComponent(target.askId)}/answer`;
    case 'backup_restore': return `/v2/backups/${encodeURIComponent(target.backupId)}/restore`;
    case 'money_draft_confirm':
      return `${MONEY_DRAFTS_PATH}/${encodeURIComponent(target.draftId)}/confirm`;
    case 'note_unlock':
      return `${NOTES_PATH}/${encodeURIComponent(target.noteId)}/unlock`;
    case 'agreement_confirm':
      return `${AGREEMENTS_PATH}/${encodeURIComponent(target.agreementId)}/confirm`;
    case 'agreement_edit':
      return `${AGREEMENTS_PATH}/${encodeURIComponent(target.agreementId)}/edit`;
    case 'node_pairing_code':
      return NODE_PAIRING_CODES_PATH;
    case 'node_limits':
      return `${NODES_PATH}/${encodeURIComponent(target.nodeId)}/limits`;
    case 'tool_group':
      return `${TOOL_GROUPS_PATH}/${encodeURIComponent(target.groupId)}`;
    case 'memory_uncertain':
      return `${MEMORY_UNCERTAIN_PATH}/${encodeURIComponent(target.uncertainId)}`;
  }
}

export type SignedResult =
  | { kind: 'device_action_answer'; response: AnswerAskResponse }
  | { kind: 'backup_restored'; preview: RestorePreview }
  | { kind: 'money_draft'; draft: MoneyDraftView }
  | { kind: 'note_unlocked' }
  | { kind: 'agreement'; agreement: AgreementView }
  | { kind: 'node_code'; code: NodePairingCodeResponse }
  | { kind: 'node'; node: NodeView }
  | { kind: 'tool_group'; group: ToolGroupView }
  | { kind: 'memory_uncertain'; item: UncertainItem };

/** 一次本人确认：保留原样请求体，确认身份由服务端的本人会话给出。 */
export interface SignedSend {
  target: SignedTarget;
  bodyText: string;
  /** 旧调用的兼容字段；当前发送路径忽略它们，不发送签名头。 */
  signedAt?: string;
  signature?: string;
}
