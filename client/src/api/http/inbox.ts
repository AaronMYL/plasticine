// /v2/inbox 的真实现：列表（十个分类）、打开一封、已读 / 收藏 / 归档、全部标已读、回复、核实一条回复发没发出去。

import type { InboxApi } from '../m5b-client.ts';
import {
  INBOX_PATH,
  INBOX_READ_ALL_PATH,
  INBOX_REPLIES_PATH,
  InboxListResponseSchema,
  InboxMessageViewSchema,
  InboxReplyResponseSchema,
  InboxRowResponseSchema,
  InboxRowViewSchema,
  SyncInboxResponseSchema,
  type SyncInboxRequest,
  type InboxFeedbackRequest,
  ReadAllInboxResponseSchema,
  type InboxListQuery,
  type InboxListResponse,
  type InboxMessageView,
  type InboxReplyView,
  type InboxRowResponse,
  type ReadAllInboxRequest,
  type ReadAllInboxResponse,
  type ReplyInboxRequest,
  type SetInboxFlagsRequest,
  type SettleInboxReplyRequest,
} from '../shared.ts';
import { conflictWith } from './conflict.ts';
import type { Transport } from './transport.ts';

export class HttpInbox implements InboxApi {
  private readonly transport: Transport;

  constructor(transport: Transport) {
    this.transport = transport;
  }

  sync(input: SyncInboxRequest, signal?: AbortSignal) {
    return this.transport.request({ method: 'POST', path: `${INBOX_PATH}/sync`, body: input,
      schema: SyncInboxResponseSchema, what: '现在收信', lostAs: 'failed', signal });
  }

  feedback(input: InboxFeedbackRequest): Promise<InboxRowResponse> {
    return this.transport.request({ method: 'POST', path: `${INBOX_PATH}/feedback`, body: input,
      schema: InboxRowResponseSchema, what: '保存建议或反馈', lostAs: 'uncertain' });
  }

  list(query: InboxListQuery, signal?: AbortSignal): Promise<InboxListResponse> {
    return this.transport.request({
      method: 'GET',
      path: INBOX_PATH,
      query: { box: query.box, q: query.q, offset: query.offset, limit: query.limit },
      schema: InboxListResponseSchema,
      what: '读站内信',
      lostAs: 'failed',
      signal,
    });
  }

  get(id: string, signal?: AbortSignal): Promise<InboxMessageView> {
    return this.transport.request({
      method: 'GET',
      path: `${INBOX_PATH}/${encodeURIComponent(id)}`,
      schema: InboxMessageViewSchema,
      what: '读这封站内信',
      lostAs: 'failed',
      signal,
    });
  }

  setFlags(id: string, input: SetInboxFlagsRequest): Promise<InboxRowResponse> {
    return this.transport.request({
      method: 'POST',
      path: `${INBOX_PATH}/${encodeURIComponent(id)}/flags`,
      body: input,
      schema: InboxRowResponseSchema,
      what: '站内信标记',
      lostAs: 'uncertain',
      refine: conflictWith(InboxRowViewSchema),
    });
  }

  readAll(input: ReadAllInboxRequest): Promise<ReadAllInboxResponse> {
    return this.transport.request({
      method: 'POST',
      path: INBOX_READ_ALL_PATH,
      body: input,
      schema: ReadAllInboxResponseSchema,
      what: '全部标已读',
      lostAs: 'uncertain',
    });
  }

  async reply(id: string, input: ReplyInboxRequest): Promise<InboxReplyView> {
    const response = await this.transport.request({
      method: 'POST',
      path: `${INBOX_PATH}/${encodeURIComponent(id)}/replies`,
      body: input,
      schema: InboxReplyResponseSchema,
      what: '回复',
      lostAs: 'uncertain',
    });
    return response.reply;
  }

  async settleReply(replyId: string, input: SettleInboxReplyRequest): Promise<InboxReplyView> {
    const response = await this.transport.request({
      method: 'POST',
      path: `${INBOX_REPLIES_PATH}/${encodeURIComponent(replyId)}/settle`,
      body: input,
      schema: InboxReplyResponseSchema,
      what: '核实回复',
      lostAs: 'uncertain',
    });
    return response.reply;
  }
}
