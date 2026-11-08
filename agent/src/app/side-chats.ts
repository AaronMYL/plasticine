// 旁聊和对话细节的接口（《优化清单》第 17 条）：开旁聊（空白 / 信息流「讨论」/ 主线里的一句）、第二栏列表、
// 表情。写都带 requestId，重发回同一个结果；推事件在事务提交之后。

import { BLANK_SIDE_TITLE, LINE_TITLE_MAX_CHARS, OpenSideRequestSchema, ReactLineMessageRequestSchema,
  SIDE_TOPIC_EXCERPT_MAX_CHARS, type LineTopic, type SideFrom } from '../../shared/api/index.ts';
import { replyExcerpt } from '../../shared/line-reply.ts';
import { lineRef, type StateService } from '../state/index.ts';
import { ApiError } from './api-error.ts';
import { param, type Reply, type RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotent } from './idempotency.ts';
import { kernel, lineCall } from './lines.ts';
import { checkInput } from './validate.ts';

function clipChars(text: string, max: number): string {
  const chars = Array.from(text.trim());
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('')}…`;
}

/** 开旁聊时带进去的那一条：信息流条目的标题、来源、摘要；主线里一句的原话。 */
function topicOf(state: StateService, from: SideFrom): LineTopic {
  if (from.kind === 'feed') {
    const item = state.feedItems.get(from.itemId);
    if (item === undefined) {
      throw new ApiError(404, 'not_found', '信息流里没有这一条了。', { next: '刷新信息流后再点「讨论」。' });
    }
    const excerpt = [item.summary, item.url === null ? '' : `原文：${item.url}`].filter((part) => part !== '')
      .join('\n');
    return { kind: 'feed', ref: item.id, title: item.title, source: item.site ?? null,
      at: item.publishedAt ?? null, excerpt: clipChars(excerpt, SIDE_TOPIC_EXCERPT_MAX_CHARS) };
  }
  const ref = lineRef(from.lineId, from.seq);
  const said = state.lineMessages.said(ref);
  if (said === undefined || said.text.trim() === '') {
    throw new ApiError(404, 'not_found', '那一条不在对话里了。', { next: '刷新后再试。' });
  }
  return { kind: 'message', ref, title: replyExcerpt(said.text), source: null, at: null,
    excerpt: clipChars(said.text, SIDE_TOPIC_EXCERPT_MAX_CHARS) };
}

function titleFor(topic: LineTopic | null, title: string | undefined): string {
  if (title !== undefined) {
    return title;
  }
  if (topic === null) {
    return BLANK_SIDE_TITLE;
  }
  return clipChars(topic.kind === 'feed' ? `讨论：${topic.title}` : topic.title, LINE_TITLE_MAX_CHARS);
}

/** POST /v2/lines/side */
export async function openSideChat(context: RequestContext): Promise<Reply> {
  const lines = kernel(context);
  const input = checkInput(OpenSideRequestSchema, await readJsonBody(context.req), '旁聊');
  return idempotent(context, input.requestId, (afterCommit) => {
    const topic = input.from === undefined ? null : topicOf(context.deps.state, input.from);
    const line = lineCall(() => lines.openSide({ title: titleFor(topic, input.title), topic }, afterCommit));
    return { status: 200, body: { line } };
  });
}

/** GET /v2/lines/chats */
export function listChats(context: RequestContext): Reply {
  return { status: 200, body: kernel(context).chats() };
}

/** POST /v2/lines/:id/reactions */
export async function reactLineMessage(context: RequestContext): Promise<Reply> {
  const lines = kernel(context);
  const input = checkInput(ReactLineMessageRequestSchema, await readJsonBody(context.req), '表情');
  const id = param(context, 'id');
  return idempotent(context, input.requestId, (afterCommit) => ({
    status: 200,
    body: { message: lineCall(() => lines.react(id, { seq: input.seq, emoji: input.emoji, on: input.on },
      afterCommit)) },
  }));
}
