import { Type } from 'typebox';
import {
  AddContactRequestSchema,
  ClaimGroupTaskRequestSchema,
  ConfirmMarksRequestSchema,
  CreateGroupRequestSchema,
  GroupRequestSchema,
  NetworkTaskVersionRequestSchema,
  SetAvatarRequestSchema,
  UpdateGroupRequestSchema,
  ContactRequestDecisionSchema,
  CreateInviteRequestSchema,
  CreateNetworkTaskRequestSchema,
  DecideNetworkTaskRequestSchema,
  DeliverNetworkTaskRequestSchema,
  JoinNetworkRequestSchema,
  ReadContactRequestSchema,
  SendContactMessageRequestSchema,
  SetContactRelationRequestSchema,
  SetMarkRequestSchema,
  VerdictNetworkTaskRequestSchema,
} from '../api/shared.ts';

const Id = Type.String();

export const CONTACTS_ACTION_REQUEST_SCHEMAS = [
  Type.Object({ kind: Type.Literal('contact_send'), contactId: Id, body: SendContactMessageRequestSchema }),
  Type.Object({ kind: Type.Literal('contact_add'), body: AddContactRequestSchema }),
  Type.Object({ kind: Type.Literal('contact_request'), contactId: Id, body: ContactRequestDecisionSchema }),
  Type.Object({ kind: Type.Literal('contact_relation'), contactId: Id, body: SetContactRelationRequestSchema }),
  Type.Object({ kind: Type.Literal('contact_read'), contactId: Id, body: ReadContactRequestSchema }),
  Type.Object({ kind: Type.Literal('contact_task'), contactId: Id, body: CreateNetworkTaskRequestSchema }),
  Type.Object({ kind: Type.Literal('network_task_decide'), taskId: Id, body: DecideNetworkTaskRequestSchema }),
  Type.Object({ kind: Type.Literal('network_task_deliver'), taskId: Id, body: DeliverNetworkTaskRequestSchema }),
  Type.Object({ kind: Type.Literal('network_task_verdict'), taskId: Id, body: VerdictNetworkTaskRequestSchema }),
  Type.Object({ kind: Type.Literal('network_join'), body: JoinNetworkRequestSchema }),
  Type.Object({ kind: Type.Literal('network_invite'), body: CreateInviteRequestSchema }),
  Type.Object({ kind: Type.Literal('visibility_mark'), body: SetMarkRequestSchema }),
  Type.Object({ kind: Type.Literal('visibility_confirm'), body: ConfirmMarksRequestSchema }),
  Type.Object({ kind: Type.Literal('group_create'), body: CreateGroupRequestSchema }),
  Type.Object({ kind: Type.Literal('group_update'), groupId: Id, body: UpdateGroupRequestSchema }),
  Type.Object({ kind: Type.Literal('group_leave'), groupId: Id, body: GroupRequestSchema }),
  Type.Object({ kind: Type.Literal('group_task'), contactId: Id, body: CreateNetworkTaskRequestSchema }),
  Type.Object({ kind: Type.Literal('group_task_claim'), taskId: Id, body: ClaimGroupTaskRequestSchema }),
  Type.Object({ kind: Type.Literal('group_task_cancel'), taskId: Id, body: GroupRequestSchema }),
  Type.Object({ kind: Type.Literal('network_task_cancel'), taskId: Id, body: NetworkTaskVersionRequestSchema }),
  Type.Object({ kind: Type.Literal('network_task_stop'), taskId: Id, body: NetworkTaskVersionRequestSchema }),
  Type.Object({ kind: Type.Literal('network_avatar'), body: SetAvatarRequestSchema }),
] as const;

export function contactOpKey(contactId: string, action: 'send' | 'request' | 'relation' | 'read' | 'task'): string {
  return `contact:${contactId}:${action}`;
}

export const CONTACT_ADD_OP_KEY = 'contact:new:add';

export function networkTaskOpKey(taskId: string,
  action: 'decide' | 'deliver' | 'verdict' | 'cancel' | 'stop'): string {
  return `network-task:${taskId}:${action}`;
}

export function groupTaskOpKey(taskId: string, action: 'claim' | 'cancel'): string {
  return `group-task:${taskId}:${action}`;
}

export const GROUP_CREATE_OP_KEY = 'group:new:create';
export const NETWORK_AVATAR_OP_KEY = 'network:avatar';

export function groupOpKey(groupId: string, action: 'update' | 'leave'): string {
  return `group:${groupId}:${action}`;
}

export const NETWORK_JOIN_OP_KEY = 'network:join';
export const NETWORK_INVITE_OP_KEY = 'network:invite';

export function visibilityOpKey(kind: string, id: string): string {
  return `visibility:${kind}:${id}`;
}

export const VISIBILITY_CONFIRM_OP_KEY = 'visibility:confirm';
