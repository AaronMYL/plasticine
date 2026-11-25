import { Type, type Static } from 'typebox';
import {
  MEMORY_UNCERTAIN_PATH, MONEY_DRAFTS_PATH, NODE_PAIRING_CODES_PATH, NODES_PATH, NOTES_PATH,
  TOOL_GROUPS_PATH, type AnswerAskResponse, type MoneyDraftView, type RestorePreview, type ToolGroupView,
  type UncertainItem,
} from './shared.ts';
import type { NodePairingCodeResponse, NodeView } from './types.ts';

export const SignedTargetSchema = Type.Union([
  Type.Object({ kind: Type.Literal('device_action_answer'), askId: Type.String({ minLength: 1 }) }),
  Type.Object({ kind: Type.Literal('backup_restore'), backupId: Type.String({ minLength: 1 }) }),
  Type.Object({ kind: Type.Literal('money_draft_confirm'), draftId: Type.String({ minLength: 1 }) }),
  Type.Object({ kind: Type.Literal('note_unlock'), noteId: Type.String({ minLength: 1 }) }),
  Type.Object({ kind: Type.Literal('node_pairing_code') }),
  Type.Object({ kind: Type.Literal('node_limits'), nodeId: Type.String({ minLength: 1 }) }),
  Type.Object({ kind: Type.Literal('tool_group'), groupId: Type.String({ minLength: 1 }) }),
  Type.Object({ kind: Type.Literal('memory_uncertain'), uncertainId: Type.String({ minLength: 1 }) }),
]);
export type SignedTarget = Static<typeof SignedTargetSchema>;

export const SIGNED_METHOD = 'POST';

export function signedPath(target: SignedTarget): string {
  switch (target.kind) {
    case 'device_action_answer': return `/v2/asks/${encodeURIComponent(target.askId)}/answer`;
    case 'backup_restore': return `/v2/backups/${encodeURIComponent(target.backupId)}/restore`;
    case 'money_draft_confirm':
      return `${MONEY_DRAFTS_PATH}/${encodeURIComponent(target.draftId)}/confirm`;
    case 'note_unlock':
      return `${NOTES_PATH}/${encodeURIComponent(target.noteId)}/unlock`;
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
  | { kind: 'node_code'; code: NodePairingCodeResponse }
  | { kind: 'node'; node: NodeView }
  | { kind: 'tool_group'; group: ToolGroupView }
  | { kind: 'memory_uncertain'; item: UncertainItem };

export interface SignedSend {
  target: SignedTarget;
  bodyText: string;
  signedAt?: string;
  signature?: string;
}
