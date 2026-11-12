// 第 113 条：联系人、跨用户任务、这台 Plasticine 在 Cyber Hunter 网络上的账号、对外可见。http/ 的真实现和 fake/ 的内存
// 实现都满足它；PlasticineApi 从这里继承（client.ts）。请求和响应的形状都是 agent/shared/api 的 contacts / network /
// visibility 三份，这里只按 schema 推类型，不另写一份。
// 带 requestId 的写操作回执不确定时抛 kind = uncertain 的 ApiError（约定 2）；带 version 的过时了抛 ConflictError。
// 规格（docs/specs/contacts-network.md 第 6 节）没写回答形状的几个写操作，这里按最接近的 schema 读（见各条注释）。

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
  /** GET /v2/contacts：并好的一张列表（人、邮件、系统来源），按最近排，另带「新请求」数、等你数、未读数。 */
  list(signal?: AbortSignal): Promise<ContactListResponse>;
  /** GET /v2/contacts/:id：资料、交付记录、代你说过、安全码。 */
  get(id: string, signal?: AbortSignal): Promise<ContactDetail>;
  /** GET /v2/contacts/:id/messages?before=：一页 50 项，AI↔AI 在服务端收成 exchange。 */
  messages(id: string, query: { before?: string }, signal?: AbortSignal): Promise<ContactMessagesResponse>;
  /** GET /v2/contacts/:id/mail/:mailId：点开一封邮件的正文（清洗过的 HTML，或只有纯文字）。 */
  mailBody(id: string, mailId: string, signal?: AbortSignal): Promise<MailBodyResponse>;
  /** POST /v2/contacts/:id/messages：发一句（target ai = 问对方的 Plasticine；邮件联系人 = 回最近一封）。 */
  send(id: string, input: SendContactMessageRequest): Promise<ContactMessageView>;
  /** POST /v2/contacts/add：按 @handle 加人。 */
  add(input: AddContactRequest): Promise<ContactRow>;
  /** POST /v2/contacts/:id/request：接受 / 拉黑 / 忽略。回答按 { contact } 读（规格没写，取最接近的）。 */
  decideRequest(id: string, input: ContactRequestDecision): Promise<ContactRow>;
  /** POST /v2/contacts/:id/relation：关系或单独档位上限，带 version。回答按 { contact } 读（同上）。 */
  setRelation(id: string, input: SetContactRelationRequest): Promise<ContactRow>;
  /** POST /v2/contacts/:id/alias：改备注（null = 去掉），带 version。 */
  setAlias(id: string, input: ContactAliasRequest): Promise<ContactRow>;
  /** POST /v2/contacts/:id/person：绑记忆里的人物页、新建一页再绑、解绑、答「不是」。 */
  setPerson(id: string, input: ContactPersonRequest): Promise<ContactRow>;
  /** POST /v2/contacts/:id/remove：删除联系人（进「最近删除」，对方不会收到通知）。 */
  remove(id: string, input: ContactRemoveRequest): Promise<ContactRow>;
  /** POST /v2/contacts/:id/restore：从「最近删除」恢复。 */
  restore(id: string, input: ContactRemoveRequest): Promise<ContactRow>;
  /** POST /v2/contacts/:id/messages/:messageId/reaction：给一句加 / 拿掉表情（联系人或群）。 */
  react(id: string, messageId: string, input: ContactReactionRequest): Promise<void>;
  /** POST /v2/contacts/:id/read：读到哪儿。回答按 { contact } 读（同上）。 */
  read(id: string, input: ReadContactRequest): Promise<ContactRow>;
  /** POST /v2/contacts/:id/safety：和对方核对过安全码，换上对方的新钥匙。回答按 { contact } 读。 */
  confirmSafety(id: string, input: ConfirmSafetyRequest): Promise<ContactRow>;
  /** POST /v2/contacts/:id/tasks：发任务。 */
  createTask(id: string, input: CreateNetworkTaskRequest): Promise<NetworkTaskView>;
  /** POST /v2/contacts/:groupId/tasks：在群里发任务卡（指给某人，或全群谁先接谁做）。 */
  createGroupTask(id: string, input: CreateNetworkTaskRequest): Promise<GroupTaskView>;
  /** GET /v2/contacts/lookup?handle=：加好友表单下面那张预览。 */
  lookup(handle: string, signal?: AbortSignal): Promise<ContactLookupResponse>;
  /** POST /v2/groups：建群。 */
  createGroup(input: CreateGroupRequest): Promise<ContactRow>;
  /** POST /v2/groups/:id：改群名、换群头像、拉人。 */
  updateGroup(id: string, input: UpdateGroupRequest): Promise<ContactRow>;
  /** POST /v2/groups/:id/leave：退群。 */
  leaveGroup(id: string, input: GroupRequest): Promise<ContactRow>;
}

export interface GroupTasksApi {
  /** GET /v2/group-tasks/:id：深链接直接打开现有任务。 */
  get(id: string, signal?: AbortSignal): Promise<GroupTaskView>;
  /** POST /v2/group-tasks/:id/claim：我来接 / 让 Plasticine 接。 */
  claim(id: string, input: ClaimGroupTaskRequest): Promise<GroupTaskView>;
  /** POST /v2/group-tasks/:id/cancel：撤回还没人接的卡。 */
  cancel(id: string, input: GroupRequest): Promise<GroupTaskView>;
}

export interface NetworkTasksApi {
  /** GET /v2/network-tasks/:id */
  get(id: string, signal?: AbortSignal): Promise<NetworkTaskView>;
  /** POST /v2/network-tasks/:id/decide：让 Plasticine 做 / 我来做 / 先不。 */
  decide(id: string, input: DecideNetworkTaskRequest): Promise<NetworkTaskView>;
  /** POST /v2/network-tasks/:id/deliver：我来做的那条交付。 */
  deliver(id: string, input: DeliverNetworkTaskRequest): Promise<NetworkTaskView>;
  /** POST /v2/network-tasks/:id/verdict：收到 / 再改改 + 一句。 */
  verdict(id: string, input: VerdictNetworkTaskRequest): Promise<NetworkTaskView>;
  /** POST /v2/network-tasks/:id/cancel：撤回（我发出、对方还没点头的）。 */
  cancel(id: string, input: NetworkTaskVersionRequest): Promise<NetworkTaskView>;
  /** POST /v2/network-tasks/:id/stop：叫停我的 Plasticine，改成我自己做。 */
  stop(id: string, input: NetworkTaskVersionRequest): Promise<NetworkTaskView>;
}

export interface NetworkApi {
  /** GET /v2/network：加入没有、自己的 @handle、中继、最近同步和错。 */
  status(signal?: AbortSignal): Promise<NetworkStatus>;
  /** POST /v2/network/join。回答按网络状态读（规格没写，取最接近的）。 */
  join(input: JoinNetworkRequest): Promise<NetworkStatus>;
  /** POST /v2/network/invites：生成一个邀请码和一句能直接发给朋友的话。 */
  createInvite(input: CreateInviteRequest): Promise<NetworkInviteResponse>;
  /** GET /v2/network/invites：自己生成过的码和用没用。 */
  invites(signal?: AbortSignal): Promise<NetworkInvite[]>;
  /** POST /v2/network/avatar：换头像（裁好的圆形小图），加密发给好友。 */
  setAvatar(input: SetAvatarRequest): Promise<NetworkStatus>;
}

export interface VisibilityApi {
  /** GET /v2/visibility：三类联系人各几个人、每条材料的档位和建议。 */
  get(signal?: AbortSignal): Promise<VisibilityResponse>;
  /** POST /v2/visibility/marks：给一条材料定档。回答按整张矩阵读（规格没写，取最接近的）。 */
  mark(input: SetMarkRequest): Promise<VisibilityResponse>;
  /** POST /v2/visibility/confirm：确认 Plasticine 的建议（不给 items = 全部）。回答同上。 */
  confirm(input: ConfirmMarksRequest): Promise<VisibilityResponse>;
}

export interface ContactsClientApi {
  contacts: ContactsApi;
  networkTasks: NetworkTasksApi;
  groupTasks: GroupTasksApi;
  network: NetworkApi;
  visibility: VisibilityApi;
}
