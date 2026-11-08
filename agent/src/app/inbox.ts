// /v2/inbox: 站内信（铃）——十个分类的列表、打开一封（全文和回复）、已读 / 收藏 / 归档、这一类全部标已读、回复，和结果待核实的
// 回复「发没发出去」。写已读这些按 requestId 幂等、带 version；回复的幂等在 daily/inbox.ts（同一个 requestId 不发第二封），
// 发信是异步的，所以不进 idempotent() 的同步事务，执行前同样再核一次会话。提交之后推 inbox_changed（带铃上的未读数）。

import {
  INBOX_PAGE_DEFAULT_LIMIT,
  InboxListQuerySchema,
  SyncInboxRequestSchema,
  InboxFeedbackRequestSchema,
  ReadAllInboxRequestSchema,
  ReplyInboxRequestSchema,
  SetInboxFlagsRequestSchema,
  SettleInboxReplyRequestSchema,
  type InboxListResponse,
  type InboxReplyResponse,
  type InboxRowResponse,
  type ReadAllInboxResponse,
} from '../../shared/api/index.ts';
import { ApiError, unauthorized } from './api-error.ts';
import { SYNC_TIMEOUT_MS } from '../cloud-tools/index.ts';
import { failureText } from '../shared-log.ts';
import { stillAuthenticated } from './auth.ts';
import { withCurrent } from './conflict.ts';
import { param, requireAuth, requireUserAuth, type Reply, type RequestContext } from './context.ts';
import { readJsonBody, readJsonBodyWithDigest } from './http.ts';
import { idempotent } from './idempotency.ts';
import { inboxMessageView, inboxReplyView, inboxRowView } from './m5b-views.ts';
import { checkInput, queryObject } from './validate.ts';

export async function syncInbox(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  checkInput(SyncInboxRequestSchema, await readJsonBody(context.req), '现在收信');
  const sync = context.deps.m5b.cloud.mailSync;
  if (!sync.configured()) { throw new ApiError(409, 'conflict', '邮箱尚未连接，暂时不能收信。'); }
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  context.res.once('close', abort);
  try {
    const added = await sync.sync(AbortSignal.any([controller.signal, AbortSignal.timeout(SYNC_TIMEOUT_MS)]));
    const state = context.deps.state.inboxSync.get();
    return { status: 200, body: { added, sync: { configured: true, lastSyncAt: state?.lastSyncAt ?? null,
      lastCount: state?.lastCount ?? null, lastError: state?.lastError ?? null } } };
  } catch (cause) {
    throw new ApiError(502, 'mail_sync_failed', `这次收信没完成：${failureText(cause)}`);
  } finally { context.res.off('close', abort); }
}

export async function addInboxFeedback(context: RequestContext): Promise<Reply> {
  const auth = requireUserAuth(context);
  const raw = await readJsonBodyWithDigest(context.req);
  const body = checkInput(InboxFeedbackRequestSchema, raw.value, '建议或反馈');
  if (body.text.trim() === '') { throw new ApiError(400, 'invalid_input', '请写一句建议或反馈。'); }
  return idempotent(context, body.requestId, (afterCommit) => {
    const { message } = context.deps.state.inboxMessages.add({ source: 'feedback', fromAddress: '用户',
      fromName: auth.device.name, title: Array.from(body.text.split('\n')[0] ?? body.text).slice(0, 80).join(''),
      body: body.text, receivedAt: context.deps.now().toISOString(), messageId: `feedback:${body.requestId}` });
    afterCommit(() => context.deps.m5b.inbox.announce(message));
    return { status: 201, body: { message: inboxRowView(message), unread: context.deps.m5b.inbox.unread() } };
  }, { bodyDigest: raw.digest });
}

/** GET /v2/inbox?box=&q=&offset=&limit= */
export function listInbox(context: RequestContext): Reply {
  requireAuth(context);
  const types = { offset: 'integer', limit: 'integer' } as const;
  const query = checkInput(InboxListQuerySchema, queryObject(context.url.searchParams, types), '查询参数');
  const { inbox, cloud } = context.deps.m5b;
  const limit = query.limit ?? INBOX_PAGE_DEFAULT_LIMIT;
  const offset = query.offset ?? 0;
  const { messages, total } = inbox.page(query.box ?? 'all', query.q, offset, limit);
  const sync = context.deps.state.inboxSync.get();
  const body: InboxListResponse = {
    messages: messages.map(inboxRowView),
    total,
    nextOffset: offset + messages.length < total ? offset + messages.length : null,
    unread: inbox.unread(),
    sync: {
      configured: cloud.mailSync.configured(),
      lastSyncAt: sync?.lastSyncAt ?? null,
      lastCount: sync?.lastCount ?? null,
      lastError: sync?.lastError ?? null,
    },
  };
  return { status: 200, body };
}

/** GET /v2/inbox/:id */
export function getInboxMessage(context: RequestContext): Reply {
  requireAuth(context);
  const { message, replies } = context.deps.m5b.inbox.open(param(context, 'id'));
  return { status: 200, body: inboxMessageView(message, replies) };
}

/** POST /v2/inbox/:id/flags */
export async function setInboxFlags(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const { requestId, version, ...flags } = checkInput(
    SetInboxFlagsRequestSchema,
    await readJsonBody(context.req),
    '站内信标记',
  );
  const id = param(context, 'id');
  const { deps } = context;
  return idempotent(context, requestId, (afterCommit) => {
    const read = () => deps.state.inboxMessages.require(id);
    const message = withCurrent(
      () => deps.m5b.inbox.setFlags(id, version, flags, afterCommit),
      () => inboxRowView(read()),
      () => read().version,
    );
    const body: InboxRowResponse = { message: inboxRowView(message), unread: deps.m5b.inbox.unread() };
    return { status: 200, body };
  });
}

/** POST /v2/inbox/read-all */
export async function readAllInbox(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const body = checkInput(ReadAllInboxRequestSchema, await readJsonBody(context.req), '全部标已读');
  const { deps } = context;
  return idempotent(context, body.requestId, (afterCommit) => {
    const changed = deps.m5b.inbox.readAll(body.box, afterCommit);
    const response: ReadAllInboxResponse = { changed: changed.length, unread: deps.m5b.inbox.unread() };
    return { status: 200, body: response };
  });
}

/** POST /v2/inbox/:id/replies */
export async function replyInbox(context: RequestContext): Promise<Reply> {
  const auth = requireUserAuth(context);
  const body = checkInput(ReplyInboxRequestSchema, await readJsonBody(context.req), '回复');
  const { deps } = context;
  if (!stillAuthenticated(deps, auth)) {
    throw unauthorized('这台设备的登录在请求途中失效了，这次没有执行。');
  }
  const reply = await deps.m5b.inbox.reply(param(context, 'id'), body.text, body.requestId, auth.device.id);
  const response: InboxReplyResponse = { reply: inboxReplyView(reply) };
  return { status: 201, body: response };
}

/** POST /v2/inbox/replies/:id/settle */
export async function settleInboxReply(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const body = checkInput(SettleInboxReplyRequestSchema, await readJsonBody(context.req), '核实回复');
  const { deps } = context;
  return idempotent(context, body.requestId, () => {
    const reply = deps.m5b.inbox.settleReply(param(context, 'id'), body.happened);
    const response: InboxReplyResponse = { reply: inboxReplyView(reply) };
    return { status: 200, body: response };
  });
}
