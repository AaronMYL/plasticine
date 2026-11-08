// 统一全文索引（2026-11-07《优化清单》第 20 条，用户 11-06 定）：⌘K、「翻对话」、记忆的默认搜索都查这一个索引。
// 这里是两端和工具共用的形状：索引里有哪几类东西、对话分哪几种线、给模型的「翻对话」工具收什么参数。

import { Type, type Static } from 'typebox';
import { TIERS, type Tier } from './api/visibility.ts';

/** 索引里的几类东西。space（空间）这一批后面才有，先占位：来源登记加上就能收。 */
export const INDEX_KINDS = ['message', 'note', 'space', 'memory', 'bookmark', 'feed', 'book'] as const;
export const IndexKindSchema = Type.Enum(INDEX_KINDS);
export type IndexKind = Static<typeof IndexKindSchema>;

/** 消息所在的线：主线、旁聊、后台线（旁聊还没有，线的种类加上就照收）。 */
export const INDEX_LINE_KINDS = ['main', 'side', 'background'] as const;
export const IndexLineKindSchema = Type.Enum(INDEX_LINE_KINDS);
export type IndexLineKind = Static<typeof IndexLineKindSchema>;

/** 「最高档位」：能看到这一档和比它更公开的（公开 < 合作 < 朋友 < 私密）。 */
export function tiersUpTo(maxTier: Tier): Tier[] {
  return TIERS.slice(0, TIERS.indexOf(maxTier) + 1);
}

// 给模型的「翻对话」（第 17 条：完整对话永久保存，要原话时按关键词、日期查原文）。只读。
export const CONVERSATION_SEARCH_LIMIT_MAX = 20;
export const ConversationSearchParameters = Type.Object({
  query: Type.String({ minLength: 1, maxLength: 200,
    description: 'Words to find in what he or Plasticine said (Chinese works; 1–2 characters also work)' }),
  from: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$',
    description: 'First day to include, YYYY-MM-DD in his time zone' })),
  to: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$',
    description: 'Last day to include, YYYY-MM-DD in his time zone' })),
  lineKind: Type.Optional(Type.Enum(INDEX_LINE_KINDS,
    { description: 'Only this kind of line: main (the main conversation), side, background (work lines)' })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: CONVERSATION_SEARCH_LIMIT_MAX })),
}, { additionalProperties: false });
export type ConversationSearchArgs = Static<typeof ConversationSearchParameters>;
