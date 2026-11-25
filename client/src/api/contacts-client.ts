import type { Static } from 'typebox';
import type {
  AddContactRequestSchema,
  ClaimGroupTaskRequestSchema,
  ConfirmMarksRequestSchema,
  ContactLookupResponse,
  CreateGroupRequestSchema,
  GroupRequestSchema,
  GroupTaskView,
  NetworkTaskVersionRequestSchema,
  SetAvatarRequestSchema,
  UpdateGroupRequestSchema,
  ContactDetail,
  ContactListResponse,
  ContactMessagesResponse,
  ContactMessageView,
  ContactRequestDecisionSchema,
  ContactRow,
  CreateInviteRequestSchema,
  CreateNetworkTaskRequestSchema,
  DecideNetworkTaskRequestSchema,
  DeliverNetworkTaskRequestSchema,
  JoinNetworkRequestSchema,
  MailBodyResponse,
  NetworkInvite,
  NetworkInviteResponseSchema,
  NetworkStatus,
  NetworkTaskView,
  ReadContactRequestSchema,
  ConfirmSafetyRequestSchema,
  SendContactMessageRequestSchema,
  SetContactRelationRequestSchema,
  ContactAliasRequestSchema,
  ContactPersonRequestSchema,
  ContactReactionRequestSchema,
  ContactRemoveRequestSchema,
  SetMarkRequestSchema,
  VerdictNetworkTaskRequestSchema,
  VisibilityResponse,
} from './shared.ts';

export type SendContactMessageRequest = Static<typeof SendContactMessageRequestSchema>;
export type AddContactRequest = Static<typeof AddContactRequestSchema>;
export type ContactRequestDecision = Static<typeof ContactRequestDecisionSchema>;
export type SetContactRelationRequest = Static<typeof SetContactRelationRequestSchema>;
export type ContactAliasRequest = Static<typeof ContactAliasRequestSchema>;
export type ContactPersonRequest = Static<typeof ContactPersonRequestSchema>;
export type ContactReactionRequest = Static<typeof ContactReactionRequestSchema>;
export type ContactRemoveRequest = Static<typeof ContactRemoveRequestSchema>;
export type ReadContactRequest = Static<typeof ReadContactRequestSchema>;
export type ConfirmSafetyRequest = Static<typeof ConfirmSafetyRequestSchema>;
export type CreateNetworkTaskRequest = Static<typeof CreateNetworkTaskRequestSchema>;
export type DecideNetworkTaskRequest = Static<typeof DecideNetworkTaskRequestSchema>;
export type DeliverNetworkTaskRequest = Static<typeof DeliverNetworkTaskRequestSchema>;
export type VerdictNetworkTaskRequest = Static<typeof VerdictNetworkTaskRequestSchema>;
export type JoinNetworkRequest = Static<typeof JoinNetworkRequestSchema>;
export type CreateInviteRequest = Static<typeof CreateInviteRequestSchema>;
export type NetworkInviteResponse = Static<typeof NetworkInviteResponseSchema>;
export type SetMarkRequest = Static<typeof SetMarkRequestSchema>;
export type ConfirmMarksRequest = Static<typeof ConfirmMarksRequestSchema>;
export type CreateGroupRequest = Static<typeof CreateGroupRequestSchema>;
export type UpdateGroupRequest = Static<typeof UpdateGroupRequestSchema>;
export type GroupRequest = Static<typeof GroupRequestSchema>;
export type ClaimGroupTaskRequest = Static<typeof ClaimGroupTaskRequestSchema>;
export type NetworkTaskVersionRequest = Static<typeof NetworkTaskVersionRequestSchema>;
export type SetAvatarRequest = Static<typeof SetAvatarRequestSchema>;

export interface ContactsApi {
  list(signal?: AbortSignal): Promise<ContactListResponse>;
  get(id: string, signal?: AbortSignal): Promise<ContactDetail>;
  messages(id: string, query: { before?: string }, signal?: AbortSignal): Promise<ContactMessagesResponse>;
  mailBody(id: string, mailId: string, signal?: AbortSignal): Promise<MailBodyResponse>;
  send(id: string, input: SendContactMessageRequest): Promise<ContactMessageView>;
  add(input: AddContactRequest): Promise<ContactRow>;
  decideRequest(id: string, input: ContactRequestDecision): Promise<ContactRow>;
  setRelation(id: string, input: SetContactRelationRequest): Promise<ContactRow>;
  setAlias(id: string, input: ContactAliasRequest): Promise<ContactRow>;
  setPerson(id: string, input: ContactPersonRequest): Promise<ContactRow>;
  remove(id: string, input: ContactRemoveRequest): Promise<ContactRow>;
  restore(id: string, input: ContactRemoveRequest): Promise<ContactRow>;
  react(id: string, messageId: string, input: ContactReactionRequest): Promise<void>;
  read(id: string, input: ReadContactRequest): Promise<ContactRow>;
  confirmSafety(id: string, input: ConfirmSafetyRequest): Promise<ContactRow>;
  createTask(id: string, input: CreateNetworkTaskRequest): Promise<NetworkTaskView>;
  createGroupTask(id: string, input: CreateNetworkTaskRequest): Promise<GroupTaskView>;
  lookup(handle: string, signal?: AbortSignal): Promise<ContactLookupResponse>;
  createGroup(input: CreateGroupRequest): Promise<ContactRow>;
  updateGroup(id: string, input: UpdateGroupRequest): Promise<ContactRow>;
  leaveGroup(id: string, input: GroupRequest): Promise<ContactRow>;
}

export interface GroupTasksApi {
  get(id: string, signal?: AbortSignal): Promise<GroupTaskView>;
  claim(id: string, input: ClaimGroupTaskRequest): Promise<GroupTaskView>;
  cancel(id: string, input: GroupRequest): Promise<GroupTaskView>;
}

export interface NetworkTasksApi {
  /** GET /v2/network-tasks/:id */
  get(id: string, signal?: AbortSignal): Promise<NetworkTaskView>;
  decide(id: string, input: DecideNetworkTaskRequest): Promise<NetworkTaskView>;
  deliver(id: string, input: DeliverNetworkTaskRequest): Promise<NetworkTaskView>;
  verdict(id: string, input: VerdictNetworkTaskRequest): Promise<NetworkTaskView>;
  cancel(id: string, input: NetworkTaskVersionRequest): Promise<NetworkTaskView>;
  stop(id: string, input: NetworkTaskVersionRequest): Promise<NetworkTaskView>;
}

export interface NetworkApi {
  status(signal?: AbortSignal): Promise<NetworkStatus>;
  join(input: JoinNetworkRequest): Promise<NetworkStatus>;
  createInvite(input: CreateInviteRequest): Promise<NetworkInviteResponse>;
  invites(signal?: AbortSignal): Promise<NetworkInvite[]>;
  setAvatar(input: SetAvatarRequest): Promise<NetworkStatus>;
}

export interface VisibilityApi {
  get(signal?: AbortSignal): Promise<VisibilityResponse>;
  mark(input: SetMarkRequest): Promise<VisibilityResponse>;
  confirm(input: ConfirmMarksRequest): Promise<VisibilityResponse>;
}

export interface ContactsClientApi {
  contacts: ContactsApi;
  networkTasks: NetworkTasksApi;
  groupTasks: GroupTasksApi;
  network: NetworkApi;
  visibility: VisibilityApi;
}
