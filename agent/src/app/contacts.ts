// /v2/contacts*（第 113 条，规格第 6 节）：一张并好的联系人列表、资料、一页聊天、发一句、按 @handle 加人、处理请求、
// 改关系 / 档位上限、标已读、核对安全码、发任务。网络上的人走 network/；邮件和系统来源走站内信（contact-mail.ts）。
// 写都按 requestId 幂等、带 version 的照现有写法回 409 + current。

import {
  AddContactRequestSchema,
  ConfirmSafetyRequestSchema,
  ContactLookupQuerySchema,
  type ContactLookupResponse,
  ContactMessagesQuerySchema,
  ContactRequestDecisionSchema,
  CreateNetworkTaskRequestSchema,
  ReadContactRequestSchema,
  SendContactMessageRequestSchema,
  SetContactRelationRequestSchema,
  type ContactDetail,
  type ContactMessagesResponse,
} from '../../shared/api/index.ts';
import { TIERS, type Tier } from '../../shared/api/visibility.ts';
import type { Contact } from '../../shared/state.ts';
import type { NetworkService } from '../network/index.ts';
import { ApiError, notFoundError } from './api-error.ts';
import { withCurrent } from './conflict.ts';
import { inboxContactRow, inboxDetail, inboxThread, parseInboxContact, readInboxContact,
  replyToInboxContact } from './contact-mail.ts';
import { contactList } from './contact-streams.ts';
import { chatNames, messageView, networkTaskView, personDetail, personRow, personThread,
  type TaskActivity, type TaskExecution } from './contact-views.ts';
import { param, requireAuth, requireUserAuth, type AppDeps, type Reply, type RequestContext } from './context.ts';
import { groupDetail, groupMessageView, groupTaskView, groupThread } from './group-views.ts';
import { isGroupId, requireGroupRow } from './groups.ts';
import { readJsonBody } from './http.ts';
import { idempotent, idempotentAsync } from './idempotency.ts';
import { checkInput, queryObject } from './validate.ts';

export function requireNetwork(deps: AppDeps): NetworkService {
  if (deps.network === null) {
    throw new ApiError(503, 'not_configured', '联系人这部分没有装上。', { next: '重启服务后再试。' });
  }
  return deps.network;
}

/** 任务卡上「在核对营业时间…」：本机 Plasticine 在做的那一步。 */
export function taskActivity(deps: AppDeps): TaskActivity {
  return (task) => deps.network.taskActivity(task);
}

export function taskExecution(deps: AppDeps): TaskExecution {
  return (task) => deps.network.taskExecution(task);
}

function requirePerson(deps: AppDeps, id: string): Contact {
  const contact = deps.state.contacts.get(id);
  if (contact === undefined) {
    throw notFoundError('这个联系人');
  }
  return contact;
}

/** 单独的档位上限：不给 = 不改，null = 按关系，其余只能是四档之一。 */
function tierCapOf(value: string | null | undefined): Tier | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  const tier = TIERS.find((candidate) => candidate === value);
  if (tier === undefined) {
    throw new ApiError(400, 'invalid_request', '档位上限只能是公开、合作、朋友、私密之一。', { field: 'tierCap' });
  }
  return tier;
}

/** GET /v2/contacts */
export function listContacts(context: RequestContext): Reply {
  requireAuth(context);
  return { status: 200, body: contactList(context.deps.state) };
}

/** GET /v2/contacts/:id */
export function getContact(context: RequestContext): Reply {
  requireAuth(context);
  const { state } = context.deps;
  const id = param(context, 'id');
  const inbox = parseInboxContact(id);
  if (inbox !== null) {
    const row = inboxContactRow(state, inbox);
    if (row === null) {
      throw notFoundError('这个联系人');
    }
    const body: ContactDetail = inboxDetail(row);
    return { status: 200, body };
  }
  if (isGroupId(id)) {
    return { status: 200, body: groupDetail(state, requireGroupRow(context.deps, id)) };
  }
  return { status: 200, body: personDetail(state, requirePerson(context.deps, id)) };
}

/** GET /v2/contacts/:id/messages?before= */
export function listContactMessages(context: RequestContext): Reply {
  requireAuth(context);
  const { state } = context.deps;
  const id = param(context, 'id');
  const query = checkInput(ContactMessagesQuerySchema, queryObject(context.url.searchParams), '查询参数');
  const inbox = parseInboxContact(id);
  if (inbox !== null) {
    return { status: 200, body: inboxThread(state, inbox, query.before) };
  }
  if (isGroupId(id)) {
    requireGroupRow(context.deps, id);
    const thread = groupThread(state, id, query.before, taskActivity(context.deps), taskExecution(context.deps));
    const body: ContactMessagesResponse = { ...thread, suggestion: null };
    return { status: 200, body };
  }
  requirePerson(context.deps, id);
  const thread = personThread(state, id, query.before, taskActivity(context.deps), taskExecution(context.deps));
  const body: ContactMessagesResponse = { ...thread, suggestion: null };
  return { status: 200, body };
}

/** POST /v2/contacts/:id/messages */
export async function sendContactMessage(context: RequestContext): Promise<Reply> {
  const auth = requireUserAuth(context);
  const body = checkInput(SendContactMessageRequestSchema, await readJsonBody(context.req), '发一句');
  const { deps } = context;
  const id = param(context, 'id');
  if (body.text.trim() === '' && (body.attachmentIds?.length ?? 0) === 0) {
    throw new ApiError(400, 'invalid_request', '写一句话或添加附件再发送。');
  }
  const inbox = parseInboxContact(id);
  if (inbox !== null) {
    if ((body.attachmentIds?.length ?? 0) > 0) {
      throw new ApiError(400, 'invalid_request', '邮件回复暂不支持消息附件。');
    }
    return idempotentAsync(context, body.requestId, async () => ({ status: 201, body: {
      message: await replyToInboxContact(deps.m5b.inbox, deps.state, inbox,
        { text: body.text, requestId: body.requestId, deviceId: auth.device.id }) } }));
  }
  const network = requireNetwork(deps);
  if (isGroupId(id)) {
    requireGroupRow(deps, id);
    return idempotent(context, body.requestId, () => {
      const message = network.postToGroup(id, { text: body.text, aiOf: body.aiOf ?? null,
        requestId: body.requestId,
        ...(body.attachmentIds === undefined ? {} : { attachmentIds: body.attachmentIds }) });
      return { status: 201, body: { message: groupMessageView(deps.state, message) } };
    });
  }
  return idempotent(context, body.requestId, () => {
    const message = network.sendMessage(id, { text: body.text, target: body.target ?? 'person',
      requestId: body.requestId,
        ...(body.attachmentIds === undefined ? {} : { attachmentIds: body.attachmentIds }) });
    return { status: 201, body: { message: messageView(message, chatNames(deps.state, id), deps.state) } };
  });
}

/** GET /v2/contacts/lookup?handle=：加好友表单下面那张预览。 */
export async function lookupContact(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const query = checkInput(ContactLookupQuerySchema, queryObject(context.url.searchParams), '查询参数');
  const found = await requireNetwork(context.deps).lookup(query.handle);
  const contact = found === null ? undefined : context.deps.state.contacts.byAccount(found.accountId);
  const body: ContactLookupResponse = {
    account: found === null ? null : { handle: found.handle, displayName: found.displayName },
    contactId: contact?.id ?? null,
    state: contact?.state ?? null,
  };
  return { status: 200, body };
}

/** POST /v2/contacts/add */
export async function addContact(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const body = checkInput(AddContactRequestSchema, await readJsonBody(context.req), '加联系人');
  const network = requireNetwork(context.deps);
  return idempotentAsync(context, body.requestId, async () => {
    const contact = await network.addContact({ handle: body.handle, note: body.note?.trim() || null,
      requestId: body.requestId });
    return { status: 201, body: { contact: personRow(context.deps.state, contact) } };
  });
}

/** POST /v2/contacts/:id/request */
export async function decideContactRequest(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const body = checkInput(ContactRequestDecisionSchema, await readJsonBody(context.req), '处理请求');
  const network = requireNetwork(context.deps);
  const id = param(context, 'id');
  requirePerson(context.deps, id);
  return idempotentAsync(context, body.requestId, async () => {
    const contact = await network.decideRequest(id, body.decision);
    return { status: 200, body: { contact: personRow(context.deps.state, contact) } };
  });
}

/** POST /v2/contacts/:id/relation */
export async function setContactRelation(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const body = checkInput(SetContactRelationRequestSchema, await readJsonBody(context.req), '改关系');
  const { deps } = context;
  const network = requireNetwork(deps);
  const id = param(context, 'id');
  requirePerson(deps, id);
  const tierCap = tierCapOf(body.tierCap);
  return idempotent(context, body.requestId, () => {
    const contact = withCurrent(
      () => network.setRelation(id, { version: body.version,
        ...(body.relation === undefined ? {} : { relation: body.relation }),
        ...(tierCap === undefined ? {} : { tierCap }) }),
      () => personRow(deps.state, requirePerson(deps, id)),
      () => requirePerson(deps, id).version,
    );
    return { status: 200, body: { contact: personRow(deps.state, contact) } };
  });
}

/** POST /v2/contacts/:id/read */
export async function readContact(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const body = checkInput(ReadContactRequestSchema, await readJsonBody(context.req), '标已读');
  const { deps } = context;
  const id = param(context, 'id');
  const inbox = parseInboxContact(id);
  return idempotent(context, body.requestId, (afterCommit) => {
    const marked = isGroupId(id) ? requireNetwork(deps).markGroupRead(requireGroupRow(deps, id).id, body.upTo)
      : inbox === null ? requireNetwork(deps).markRead(requirePerson(deps, id).id, body.upTo)
        : readInboxContact(deps.m5b.inbox, deps.state, inbox, body.upTo, afterCommit);
    const list = contactList(deps.state);
    const contact = list.contacts.find((row) => row.id === id) ?? null;
    if (contact === null) { throw new ApiError(404, 'not_found', '没有这个联系人。'); }
    return { status: 200, body: { contact, marked, unread: list.unread } };
  });
}

/** POST /v2/contacts/:id/safety：核对过安全码，换上新钥匙。 */
export async function confirmContactSafety(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const body = checkInput(ConfirmSafetyRequestSchema, await readJsonBody(context.req), '核对安全码');
  const { deps } = context;
  const network = requireNetwork(deps);
  const id = param(context, 'id');
  requirePerson(deps, id);
  return idempotent(context, body.requestId, () => {
    const contact = withCurrent(() => network.confirmSafety(id, body.version),
      () => personRow(deps.state, requirePerson(deps, id)), () => requirePerson(deps, id).version);
    return { status: 200, body: { contact: personRow(deps.state, contact) } };
  });
}

/** POST /v2/contacts/:id/tasks */
export async function createContactTask(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const body = checkInput(CreateNetworkTaskRequestSchema, await readJsonBody(context.req), '发任务');
  const { deps } = context;
  const network = requireNetwork(deps);
  const id = param(context, 'id');
  if (parseInboxContact(id) !== null) {
    throw new ApiError(409, 'conflict', '任务只能发给网络上的人。');
  }
  if (isGroupId(id)) {
    requireGroupRow(deps, id);
    return idempotent(context, body.requestId, () => {
      const task = network.offerGroupTask(id, { title: body.title, goal: body.goal, deadline: body.deadline ?? null,
        attachment: body.attachment ?? null, assignee: body.assignee ?? null, requestId: body.requestId });
      return { status: 201, body: { task: groupTaskView(deps.state, task) } };
    });
  }
  requirePerson(deps, id);
  return idempotent(context, body.requestId, () => {
    const task = network.offerTask(id, { title: body.title, goal: body.goal, acceptance: body.acceptance ?? null,
      deadline: body.deadline ?? null, attachment: body.attachment ?? null, requestId: body.requestId });
    return { status: 201, body: { task: networkTaskView(task) } };
  });
}
