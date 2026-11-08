// /v2/web-tabs：竖排网页标签（《优化清单》第 2 条；11-08 起存在本体里，每台设备看到同一份）。摆放只有一份：置顶、
// 分组、今天、关掉的。这台设备上「在看哪一个」不在这里（各台设备各自记）。
// 写法：客户端每次改完送一整份摆放和它画出来时的 version；别的设备先改过就 409，带现在那一份，客户端在它上面把自己
// 这几步重做一遍再送。还没搬上来的旧存档（某台设备 localStorage 里的）用 merge 合并：同一个网址已经有了就不再加。
// 摆放的规整与合并在 ../web-tabs-layout.ts，两端共用。

import { Type, type Static } from 'typebox';
import { API_PREFIX, RequestIdSchema } from './common.ts';
import { PROJECT_HUES } from './project-tag.ts';

export const WEB_TABS_PATH = `${API_PREFIX}/web-tabs`;
export const WEB_TABS_MERGE_PATH = `${WEB_TABS_PATH}/merge`;

/** 「关掉的」最多记这么多（够 ⌘K 找回近几周的），再早的不再列（库里的行留着）。 */
export const WEB_TABS_ARCHIVED_MAX = 200;
/** 一份摆放里最多这么多个标签（书签搬过来的那一组可能很长）。 */
export const WEB_TABS_LAYOUT_MAX = 5_000;
export const WEB_TAB_GROUPS_MAX = 500;
/** 网址和标题的上限：和书签同一档。 */
export const WEB_TAB_URL_MAX = 4_096;
export const WEB_TAB_TITLE_MAX = 500;

const STRICT = { additionalProperties: false };
const Id = Type.String({ minLength: 1, maxLength: 200 });
const Time = Type.String({ minLength: 1, maxLength: 40 });
const Url = Type.String({ minLength: 1, maxLength: WEB_TAB_URL_MAX });
const Title = Type.String({ maxLength: WEB_TAB_TITLE_MAX });

export const WebTabOpenerSchema = Type.Union([Type.Literal('user'), Type.Literal('plasticine')]);
export type TabOpener = Static<typeof WebTabOpenerSchema>;

export const WebTabSchema = Type.Object({
  id: Id,
  kind: Type.Literal('web'),
  url: Url,
  title: Title,
  openedBy: WebTabOpenerSchema,
  /** 打开的时间（ISO）。 */
  openedAt: Time,
  /** 上次切到它的时间（ISO）：「今天」按它清，首页「接着看」按它排。 */
  visitedAt: Time,
}, STRICT);
export type WebTab = Static<typeof WebTabSchema>;

export const WebTabGroupSchema = Type.Object({
  id: Id,
  name: Type.String({ maxLength: WEB_TAB_TITLE_MAX }),
  hue: Type.Enum(PROJECT_HUES),
  collapsed: Type.Boolean(),
  /** 组里的标签，按竖排的先后。 */
  tabIds: Type.Array(Id, { maxItems: WEB_TABS_LAYOUT_MAX }),
}, STRICT);
export type WebTabGroup = Static<typeof WebTabGroupSchema>;

/** 关掉的、过了一天从「今天」收走的：⌘K 搜得到，点了重新打开。 */
export const ArchivedTabSchema = Type.Object({
  key: Id,
  url: Url,
  title: Title,
  closedAt: Time,
}, STRICT);
export type ArchivedTab = Static<typeof ArchivedTabSchema>;

export const WebTabsLayoutSchema = Type.Object({
  tabs: Type.Array(WebTabSchema, { maxItems: WEB_TABS_LAYOUT_MAX }),
  /** 置顶（最上面一排图标），按先后。 */
  pinned: Type.Array(Id, { maxItems: WEB_TABS_LAYOUT_MAX }),
  groups: Type.Array(WebTabGroupSchema, { maxItems: WEB_TAB_GROUPS_MAX }),
  /** 今天打开的，按竖排的先后（新开的在最上面）。 */
  today: Type.Array(Id, { maxItems: WEB_TABS_LAYOUT_MAX }),
  archived: Type.Array(ArchivedTabSchema, { maxItems: WEB_TABS_ARCHIVED_MAX }),
}, STRICT);
export type WebTabsLayout = Static<typeof WebTabsLayoutSchema>;

/** GET /v2/web-tabs、PUT / merge 成功时回的：现在那一份和它的版本（每写一次加一）。 */
export const WebTabsResponseSchema = Type.Object({
  layout: WebTabsLayoutSchema,
  version: Type.Integer({ minimum: 0 }),
}, STRICT);
export type WebTabsResponse = Static<typeof WebTabsResponseSchema>;

/**
 * PUT /v2/web-tabs → 200 PutWebTabsResponse（只回新版本：客户端手上的就是送去的那一份，两端规整的写法一样；
 * 回执要存进幂等记录，不带整份）。baseVersion 不是现在的版本 → 409，extra.current 是现在那一份（WebTabsResponse）。
 */
export const PutWebTabsRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  baseVersion: Type.Integer({ minimum: 0 }),
  layout: WebTabsLayoutSchema,
}, STRICT);
export type PutWebTabsRequest = Static<typeof PutWebTabsRequestSchema>;
export const PutWebTabsResponseSchema = Type.Object({ version: Type.Integer({ minimum: 0 }) }, STRICT);
export type PutWebTabsResponse = Static<typeof PutWebTabsResponseSchema>;

/** POST /v2/web-tabs/merge → 200 WebTabsResponse：某台设备上还没搬上来的旧存档，同一个网址已经有了的跳过。 */
export const MergeWebTabsRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  layout: WebTabsLayoutSchema,
}, STRICT);
export type MergeWebTabsRequest = Static<typeof MergeWebTabsRequestSchema>;
