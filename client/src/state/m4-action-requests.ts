// M4 的写操作在 action-ops 里存成什么样：每日设置、信息流（加一条链接、赞 / 不感兴趣、收藏、来源多少、评论）。
// 请求体用 shared 里的 schema，标识就在请求体里。2026-11-05 关切、回来汇报、十件事删了。

import { Type } from 'typebox';
import {
  AddFeedItemRequestSchema,
  AddInterestRequestSchema, BlockFeedSiteRequestSchema, RefreshFeedRequestSchema,
  AddFeedCommentRequestSchema, RetryFeedCommentRequestSchema,
  ReactFeedItemRequestSchema,
  SaveFeedItemRequestSchema,
  SetSourceLevelRequestSchema,
  SetSourceQueryRequestSchema,
  UpdateDailySettingsRequestSchema,
} from '../api/shared.ts';

export const M4_ACTION_REQUEST_SCHEMAS = [
  Type.Object({ kind: Type.Literal('daily_settings'), body: UpdateDailySettingsRequestSchema }),
  Type.Object({ kind: Type.Literal('feed_refresh'), body: RefreshFeedRequestSchema }),
  Type.Object({ kind: Type.Literal('feed_interest'), body: AddInterestRequestSchema }),
  Type.Object({ kind: Type.Literal('feed_block'), body: BlockFeedSiteRequestSchema }),
  Type.Object({ kind: Type.Literal('feed_comment'), itemId: Type.String(), body: AddFeedCommentRequestSchema }),
  Type.Object({ kind: Type.Literal('feed_comment_retry'), itemId: Type.String(), commentId: Type.String(),
    body: RetryFeedCommentRequestSchema }),
  Type.Object({ kind: Type.Literal('feed_add'), timeZone: Type.String(), body: AddFeedItemRequestSchema }),
  Type.Object({ kind: Type.Literal('feed_react'), itemId: Type.String(), body: ReactFeedItemRequestSchema }),
  Type.Object({ kind: Type.Literal('feed_save'), itemId: Type.String(), body: SaveFeedItemRequestSchema }),
  Type.Object({ kind: Type.Literal('feed_level'), sourceId: Type.String(), body: SetSourceLevelRequestSchema }),
  Type.Object({ kind: Type.Literal('feed_query'), sourceId: Type.String(), body: SetSourceQueryRequestSchema }),
] as const;

export const DAILY_SETTINGS_OP_KEY = 'settings:daily:save';

export function feedItemOpKey(itemId: string, action: 'react' | 'save'): string {
  return `feed:${itemId}:${action}`;
}

export const FEED_ADD_OP_KEY = 'feed:new:add';

export function feedLevelOpKey(sourceId: string): string {
  return `feed:source:${sourceId}:level`;
}

export function feedQueryOpKey(sourceId: string): string {
  return `feed:source:${sourceId}:query`;
}
