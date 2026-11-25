import { Type, type Static } from 'typebox';
import { CONVERSATION_ATTACHMENT_MAX_COUNT, INLINE_ATTACHMENT_MAX_BYTES } from './attachments.ts';
import { PageOperateEventSchema } from './page-operate.ts';
import { WebTabIconEventSchema } from './desktop-bridge.ts';

export const MacAttachFilesSchema = Type.Array(Type.Object({
  name: Type.String({ minLength: 1 }),
  type: Type.String(),
  base64: Type.String({ maxLength: Math.ceil(INLINE_ATTACHMENT_MAX_BYTES / 3) * 4 }),
}, { additionalProperties: false }), { maxItems: CONVERSATION_ATTACHMENT_MAX_COUNT });
export type MacAttachedFile = Static<typeof MacAttachFilesSchema>[number];

const STRICT = { additionalProperties: false };
const TabId = Type.String({ minLength: 1, maxLength: 100 });
export const WEB_TABS_MAX = 50;
export const WEB_PAGE_TEXT_MAX_CHARS = 100_000;

export const WebTabFrameSchema = Type.Object({
  x: Type.Number(),
  y: Type.Number(),
  width: Type.Number({ minimum: 0 }),
  height: Type.Number({ minimum: 0 }),
}, STRICT);
export type WebTabFrame = Static<typeof WebTabFrameSchema>;

export const HIT_REGIONS_MAX = 200;

export const WebTabsSyncSchema = Type.Object({
  tabs: Type.Array(Type.Object({ tabId: TabId, url: Type.String({ minLength: 1, maxLength: 4_096 }),
    openedBy: Type.Optional(Type.Union([Type.Literal('user'), Type.Literal('plasticine')])) }, STRICT),
    { maxItems: WEB_TABS_MAX }),
  active: Type.Union([TabId, Type.Null()]),
  frame: Type.Union([WebTabFrameSchema, Type.Null()]),
  hitRegions: Type.Optional(Type.Array(WebTabFrameSchema, { maxItems: HIT_REGIONS_MAX })),
}, STRICT);
export type WebTabsSync = Static<typeof WebTabsSyncSchema>;

export const WEB_TAB_COMMANDS = ['back', 'forward', 'reload', 'stop', 'open_external', 'close'] as const;
export type WebTabCommand = (typeof WEB_TAB_COMMANDS)[number];

export const WebPageSnapshotSchema = Type.Object({
  tabId: TabId,
  url: Type.String(),
  title: Type.String(),
  text: Type.String(),
  totalChars: Type.Integer({ minimum: 0 }),
  truncated: Type.Boolean(),
}, STRICT);
export type WebPageSnapshot = Static<typeof WebPageSnapshotSchema>;

export const WebTabEventSchema = Type.Union([
  Type.Object({
    type: Type.Literal('state'),
    tabId: TabId,
    url: Type.String(),
    title: Type.String(),
    canGoBack: Type.Boolean(),
    canGoForward: Type.Boolean(),
    loading: Type.Boolean(),
  }, STRICT),
  Type.Object({
    type: Type.Literal('opened'),
    tabId: TabId,
    url: Type.String(),
    title: Type.String(),
    openedBy: Type.Union([Type.Literal('user'), Type.Literal('plasticine')]),
    activate: Type.Boolean(),
  }, STRICT),
  Type.Object({ type: Type.Literal('closed'), tabId: TabId }, STRICT),
  Type.Object({ type: Type.Literal('show'), tabId: TabId }, STRICT),
  WebTabIconEventSchema,
  Type.Object({ type: Type.Literal('internal'), hash: Type.String({ pattern: '^#/' }) }, STRICT),
  PageOperateEventSchema,
]);
export type WebTabEvent = Static<typeof WebTabEventSchema>;

export interface PlasticineMacWebTabs {
  sync(state: WebTabsSync): void;
  command(tabId: string, command: WebTabCommand): void;
  navigate(tabId: string, url: string): void;
  snapshot(tabId: string): Promise<unknown>;
  tools?: readonly string[];
  tool?(tabId: string, tool: import('./web-page-tools.ts').WebPageTool): Promise<unknown>;
}

export const TITLEBAR_HEIGHT = 44;

export const WindowChromeSchema = Type.Object({
  trafficLightInset: Type.Number({ minimum: 0, maximum: 200 }),
  fullScreen: Type.Boolean(),
  controlsRight: Type.Optional(Type.Number({ minimum: 0, maximum: 400 })),
}, STRICT);
export type WindowChrome = Static<typeof WindowChromeSchema>;

export interface PlasticineMacWindowChrome {
  current(): unknown;
}

export interface PlasticineMacBridge {
  version: string;
  notify(title: string, body: string, hash: string): void;
  webTabs?: PlasticineMacWebTabs;
  windowChrome?: PlasticineMacWindowChrome;
  translate?: import('./mac-translate.ts').PlasticineMacTranslate;
  logins?: import('./mac-logins.ts').PlasticineMacLogins;
}
