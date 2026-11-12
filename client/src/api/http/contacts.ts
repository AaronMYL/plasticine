// /v2/contacts 和 /v2/network-tasks 的真实现（第 113 条）：并好的联系人列表、一个联系人的资料和聊天、发一句、加人、处理
// 请求、改关系、标已读、发任务；对方发来的任务表态、交付、验收。带 version 的 409 认出现在那一条（联系人行 / 任务）。

import type {
  AddContactRequest,
  ClaimGroupTaskRequest,
  ContactRequestDecision,
  CreateGroupRequest,
  GroupRequest,
  GroupTasksApi,
  NetworkTaskVersionRequest,
  UpdateGroupRequest,
  ContactsApi,
  CreateNetworkTaskRequest,
  DecideNetworkTaskRequest,
  DeliverNetworkTaskRequest,
  NetworkTasksApi,
  ReadContactRequest,
  SendContactMessageRequest,
  SetContactRelationRequest,
  ConfirmSafetyRequest,
  ContactAliasRequest,
  ContactPersonRequest,
  ContactReactionRequest,
  ContactRemoveRequest,
  VerdictNetworkTaskRequest,
} from '../contacts-client.ts';
import {
  BrowserAckResponseSchema,
  CONTACT_LOOKUP_PATH,
  CONTACTS_ADD_PATH,
  CONTACTS_PATH,
  ContactLookupResponseSchema,
  GROUP_TASKS_PATH,
  GROUPS_PATH,
  GroupTaskResponseSchema,
  type ContactLookupResponse,
  type GroupTaskView,
  ContactDetailSchema,
  MailBodyResponseSchema,
  ContactListResponseSchema,
  ContactMessagesResponseSchema,
  ContactRowResponseSchema,
  ContactRowSchema,
  NETWORK_TASKS_PATH,
  NetworkTaskResponseSchema,
  NetworkTaskViewSchema,
  SendContactMessageResponseSchema,
  type ContactDetail,
  type ContactListResponse,
  type ContactMessagesResponse,
  type ContactMessageView,
  type ContactRow,
  type MailBodyResponse,
  type NetworkTaskView,
} from '../shared.ts';
import { conflictWith } from './conflict.ts';
import type { Transport } from './transport.ts';

function contactPath(id: string, tail = ''): string {
  return `${CONTACTS_PATH}/${encodeURIComponent(id)}${tail}`;
}

function taskPath(id: string, tail = ''): string {
  return `${NETWORK_TASKS_PATH}/${encodeURIComponent(id)}${tail}`;
}

export class HttpContacts implements ContactsApi {
  private readonly transport: Transport;

  constructor(transport: Transport) {
    this.transport = transport;
  }

  list(signal?: AbortSignal): Promise<ContactListResponse> {
    return this.transport.request({
      method: 'GET',
      path: CONTACTS_PATH,
      schema: ContactListResponseSchema,
      what: '读联系人',
      lostAs: 'failed',
      signal,
    });
  }

  get(id: string, signal?: AbortSignal): Promise<ContactDetail> {
    return this.transport.request({
      method: 'GET',
      path: contactPath(id),
      schema: ContactDetailSchema,
      what: '读这个联系人',
      lostAs: 'failed',
      signal,
    });
  }

  messages(id: string, query: { before?: string }, signal?: AbortSignal): Promise<ContactMessagesResponse> {
    return this.transport.request({
      method: 'GET',
      path: contactPath(id, '/messages'),
      query: { before: query.before },
      schema: ContactMessagesResponseSchema,
      what: '读聊天',
      lostAs: 'failed',
      signal,
    });
  }

  mailBody(id: string, mailId: string, signal?: AbortSignal): Promise<MailBodyResponse> {
    return this.transport.request({
      method: 'GET',
      path: contactPath(id, `/mail/${encodeURIComponent(mailId)}`),
      schema: MailBodyResponseSchema,
      what: '读这封邮件',
      lostAs: 'failed',
      signal,
    });
  }

  async send(id: string, input: SendContactMessageRequest): Promise<ContactMessageView> {
    const response = await this.transport.request({
      method: 'POST',
      path: contactPath(id, '/messages'),
      body: input,
      schema: SendContactMessageResponseSchema,
      what: '发送',
      lostAs: 'uncertain',
    });
    return response.message;
  }

  async add(input: AddContactRequest): Promise<ContactRow> {
    const response = await this.transport.request({
      method: 'POST',
      path: CONTACTS_ADD_PATH,
      body: input,
      schema: ContactRowResponseSchema,
      what: '加联系人',
      lostAs: 'uncertain',
    });
    return response.contact;
  }

  async decideRequest(id: string, input: ContactRequestDecision): Promise<ContactRow> {
    const response = await this.transport.request({
      method: 'POST',
      path: contactPath(id, '/request'),
      body: input,
      schema: ContactRowResponseSchema,
      what: '处理请求',
      lostAs: 'uncertain',
    });
    return response.contact;
  }

  async setRelation(id: string, input: SetContactRelationRequest): Promise<ContactRow> {
    const response = await this.transport.request({
      method: 'POST',
      path: contactPath(id, '/relation'),
      body: input,
      schema: ContactRowResponseSchema,
      what: '改关系',
      lostAs: 'uncertain',
      refine: conflictWith(ContactRowSchema),
    });
    return response.contact;
  }

  async setAlias(id: string, input: ContactAliasRequest): Promise<ContactRow> {
    return this.#edit(id, '/alias', input, '改备注');
  }

  async setPerson(id: string, input: ContactPersonRequest): Promise<ContactRow> {
    return this.#edit(id, '/person', input, '关联人物');
  }

  async remove(id: string, input: ContactRemoveRequest): Promise<ContactRow> {
    return this.#edit(id, '/remove', input, '删除联系人');
  }

  async restore(id: string, input: ContactRemoveRequest): Promise<ContactRow> {
    return this.#edit(id, '/restore', input, '恢复联系人');
  }

  async react(id: string, messageId: string, input: ContactReactionRequest): Promise<void> {
    await this.transport.request({
      method: 'POST',
      path: contactPath(id, `/messages/${encodeURIComponent(messageId)}/reaction`),
      body: input,
      schema: BrowserAckResponseSchema,
      what: '加表情',
      lostAs: 'uncertain',
    });
  }

  async #edit(id: string, tail: string, input: object, what: string): Promise<ContactRow> {
    const response = await this.transport.request({
      method: 'POST',
      path: contactPath(id, tail),
      body: input,
      schema: ContactRowResponseSchema,
      what,
      lostAs: 'uncertain',
      refine: conflictWith(ContactRowSchema),
    });
    return response.contact;
  }

  async confirmSafety(id: string, input: ConfirmSafetyRequest): Promise<ContactRow> {
    const response = await this.transport.request({
      method: 'POST',
      path: contactPath(id, '/safety'),
      body: input,
      schema: ContactRowResponseSchema,
      what: '核对安全码',
      lostAs: 'uncertain',
      refine: conflictWith(ContactRowSchema),
    });
    return response.contact;
  }

  async read(id: string, input: ReadContactRequest): Promise<ContactRow> {
    const response = await this.transport.request({
      method: 'POST',
      path: contactPath(id, '/read'),
      body: input,
      schema: ContactRowResponseSchema,
      what: '标已读',
      lostAs: 'uncertain',
    });
    return response.contact;
  }

  async createTask(id: string, input: CreateNetworkTaskRequest): Promise<NetworkTaskView> {
    const response = await this.transport.request({
      method: 'POST',
      path: contactPath(id, '/tasks'),
      body: input,
      schema: NetworkTaskResponseSchema,
      what: '发任务',
      lostAs: 'uncertain',
    });
    return response.task;
  }

  async createGroupTask(id: string, input: CreateNetworkTaskRequest): Promise<GroupTaskView> {
    const response = await this.transport.request({
      method: 'POST',
      path: contactPath(id, '/tasks'),
      body: input,
      schema: GroupTaskResponseSchema,
      what: '发任务卡',
      lostAs: 'uncertain',
    });
    return response.task;
  }

  lookup(handle: string, signal?: AbortSignal): Promise<ContactLookupResponse> {
    return this.transport.request({
      method: 'GET',
      path: CONTACT_LOOKUP_PATH,
      query: { handle },
      schema: ContactLookupResponseSchema,
      what: '找人',
      lostAs: 'failed',
      signal,
    });
  }

  createGroup(input: CreateGroupRequest): Promise<ContactRow> {
    return this.groupWrite(GROUPS_PATH, input, '建群');
  }

  updateGroup(id: string, input: UpdateGroupRequest): Promise<ContactRow> {
    return this.groupWrite(`${GROUPS_PATH}/${encodeURIComponent(id)}`, input, '改群');
  }

  leaveGroup(id: string, input: GroupRequest): Promise<ContactRow> {
    return this.groupWrite(`${GROUPS_PATH}/${encodeURIComponent(id)}/leave`, input, '退群');
  }

  private async groupWrite(path: string, body: unknown, what: string): Promise<ContactRow> {
    const response = await this.transport.request({ method: 'POST', path, body, schema: ContactRowResponseSchema,
      what, lostAs: 'uncertain' });
    return response.contact;
  }
}

export class HttpGroupTasks implements GroupTasksApi {
  private readonly transport: Transport;

  constructor(transport: Transport) {
    this.transport = transport;
  }

  async get(id: string, signal?: AbortSignal): Promise<GroupTaskView> {
    const response = await this.transport.request({ method: 'GET',
      path: `${GROUP_TASKS_PATH}/${encodeURIComponent(id)}`, schema: GroupTaskResponseSchema,
      what: '读群任务', lostAs: 'failed', signal });
    return response.task;
  }

  claim(id: string, input: ClaimGroupTaskRequest): Promise<GroupTaskView> {
    return this.write(id, '/claim', input, '接任务');
  }

  cancel(id: string, input: GroupRequest): Promise<GroupTaskView> {
    return this.write(id, '/cancel', input, '撤回任务卡');
  }

  private async write(id: string, tail: string, body: unknown, what: string): Promise<GroupTaskView> {
    const response = await this.transport.request({ method: 'POST',
      path: `${GROUP_TASKS_PATH}/${encodeURIComponent(id)}${tail}`, body, schema: GroupTaskResponseSchema, what,
      lostAs: 'uncertain' });
    return response.task;
  }
}

export class HttpNetworkTasks implements NetworkTasksApi {
  private readonly transport: Transport;

  constructor(transport: Transport) {
    this.transport = transport;
  }

  async get(id: string, signal?: AbortSignal): Promise<NetworkTaskView> {
    const response = await this.transport.request({
      method: 'GET',
      path: taskPath(id),
      schema: NetworkTaskResponseSchema,
      what: '读这条任务',
      lostAs: 'failed',
      signal,
    });
    return response.task;
  }

  decide(id: string, input: DecideNetworkTaskRequest): Promise<NetworkTaskView> {
    return this.write(id, '/decide', input, '表态');
  }

  deliver(id: string, input: DeliverNetworkTaskRequest): Promise<NetworkTaskView> {
    return this.write(id, '/deliver', input, '交付');
  }

  verdict(id: string, input: VerdictNetworkTaskRequest): Promise<NetworkTaskView> {
    return this.write(id, '/verdict', input, '验收');
  }

  cancel(id: string, input: NetworkTaskVersionRequest): Promise<NetworkTaskView> {
    return this.write(id, '/cancel', input, '撤回');
  }

  stop(id: string, input: NetworkTaskVersionRequest): Promise<NetworkTaskView> {
    return this.write(id, '/stop', input, '停止');
  }

  private async write(id: string, tail: string, body: unknown, what: string): Promise<NetworkTaskView> {
    const response = await this.transport.request({
      method: 'POST',
      path: taskPath(id, tail),
      body,
      schema: NetworkTaskResponseSchema,
      what,
      lostAs: 'uncertain',
      refine: conflictWith(NetworkTaskViewSchema),
    });
    return response.task;
  }
}
