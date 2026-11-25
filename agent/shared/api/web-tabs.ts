import { Type, type Static } from 'typebox';
import { API_PREFIX, RequestIdSchema } from './common.ts';
import { PROJECT_HUES } from './project-tag.ts';

export const WEB_TABS_PATH = `${API_PREFIX}/web-tabs`;
export const WEB_TABS_MERGE_PATH = `${WEB_TABS_PATH}/merge`;

export const WEB_TABS_ARCHIVED_MAX = 200;
export const WEB_TABS_LAYOUT_MAX = 5_000;
export const WEB_TAB_GROUPS_MAX = 500;
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
  openedAt: Time,
  visitedAt: Time,
}, STRICT);
export type WebTab = Static<typeof WebTabSchema>;

export const WebTabGroupSchema = Type.Object({
  id: Id,
  name: Type.String({ maxLength: WEB_TAB_TITLE_MAX }),
  hue: Type.Enum(PROJECT_HUES),
  collapsed: Type.Boolean(),
  tabIds: Type.Array(Id, { maxItems: WEB_TABS_LAYOUT_MAX }),
}, STRICT);
export type WebTabGroup = Static<typeof WebTabGroupSchema>;

export const ArchivedTabSchema = Type.Object({
  key: Id,
  url: Url,
  title: Title,
  closedAt: Time,
}, STRICT);
export type ArchivedTab = Static<typeof ArchivedTabSchema>;

export const WebTabsLayoutSchema = Type.Object({
  tabs: Type.Array(WebTabSchema, { maxItems: WEB_TABS_LAYOUT_MAX }),
  pinned: Type.Array(Id, { maxItems: WEB_TABS_LAYOUT_MAX }),
  groups: Type.Array(WebTabGroupSchema, { maxItems: WEB_TAB_GROUPS_MAX }),
  today: Type.Array(Id, { maxItems: WEB_TABS_LAYOUT_MAX }),
  archived: Type.Array(ArchivedTabSchema, { maxItems: WEB_TABS_ARCHIVED_MAX }),
}, STRICT);
export type WebTabsLayout = Static<typeof WebTabsLayoutSchema>;

export const WebTabsResponseSchema = Type.Object({
  layout: WebTabsLayoutSchema,
  version: Type.Integer({ minimum: 0 }),
}, STRICT);
export type WebTabsResponse = Static<typeof WebTabsResponseSchema>;

export const PutWebTabsRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  baseVersion: Type.Integer({ minimum: 0 }),
  layout: WebTabsLayoutSchema,
}, STRICT);
export type PutWebTabsRequest = Static<typeof PutWebTabsRequestSchema>;
export const PutWebTabsResponseSchema = Type.Object({ version: Type.Integer({ minimum: 0 }) }, STRICT);
export type PutWebTabsResponse = Static<typeof PutWebTabsResponseSchema>;

export const MergeWebTabsRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  layout: WebTabsLayoutSchema,
}, STRICT);
export type MergeWebTabsRequest = Static<typeof MergeWebTabsRequestSchema>;
