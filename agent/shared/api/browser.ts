import { Type, type Static } from 'typebox';
import { API_PREFIX, IsoTimeSchema, RequestIdSchema } from './common.ts';
import { OrNull } from './lineage.ts';

export const BROWSER_PATH = `${API_PREFIX}/browser`;
export const BROWSER_OPEN_PATH = `${BROWSER_PATH}/open`;
export const BROWSER_ACTIONS_PATH = `${BROWSER_PATH}/actions`;
export const BROWSER_FRAME_PATH = `${BROWSER_PATH}/frame`;
export const BROWSER_STREAM_PATH = `${BROWSER_PATH}/stream`;
export const BROWSER_ACK_PATH = `${BROWSER_PATH}/ack`;
export const BROWSER_TABS_PATH = `${BROWSER_PATH}/tabs`;
export const ACTIONS_PATH = `${API_PREFIX}/actions`;
const FRAME_MAX = 4_096;

export const BrowserTabSchema = Type.Object({ id: Type.String(), url: Type.String(), title: Type.String() });
export type BrowserTab = Static<typeof BrowserTabSchema>;
export const BrowserUrlSchema = Type.String({ minLength: 1, maxLength: 3_000 });
export const BrowserNavigationSchema = Type.Object({ url: BrowserUrlSchema }, { additionalProperties: false });

export const BrowserViewSchema = Type.Object({
  open: Type.Boolean(),
  url: OrNull(Type.String()),
  title: OrNull(Type.String()),
  updatedAt: OrNull(IsoTimeSchema),
  lastAction: OrNull(Type.String()),
  available: Type.Optional(Type.Boolean()),
  tabs: Type.Optional(Type.Array(BrowserTabSchema)),
  activeTabId: Type.Optional(OrNull(Type.String())),
  controller: Type.Optional(Type.Enum(['idle', 'brain', 'user'])),
  loading: Type.Optional(Type.Boolean()),
  editableFocused: Type.Optional(Type.Boolean()),
  instanceId: Type.Optional(Type.String()),
  revision: Type.Optional(Type.Integer({ minimum: 0 })),
});
export type BrowserViewDto = Static<typeof BrowserViewSchema>;

/** GET /v2/browser → { browser } */
export const BrowserResponseSchema = Type.Object({ browser: BrowserViewSchema });
export type BrowserResponse = Static<typeof BrowserResponseSchema>;

/** POST /v2/browser/open → 200 { browser } */
export const OpenBrowserRequestSchema = Type.Object(
  { requestId: RequestIdSchema, instanceId: Type.Optional(Type.String()),
    url: BrowserUrlSchema },
  { additionalProperties: false },
);
export type OpenBrowserRequest = Static<typeof OpenBrowserRequestSchema>;

const Px = Type.Integer({ minimum: 0, maximum: FRAME_MAX });
export const BrowserActionInputSchema = Type.Union([
  Type.Object({ kind: Type.Literal('click'), x: Px, y: Px }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('move'), x: Px, y: Px }, { additionalProperties: false }),
  Type.Object(
    { kind: Type.Literal('type'), text: Type.String({ minLength: 1, maxLength: 2_000 }) },
    { additionalProperties: false },
  ),
  Type.Object({ kind: Type.Literal('key'), key: Type.String({ minLength: 1, maxLength: 40 }),
    code: Type.Optional(Type.String({ maxLength: 40 })), event: Type.Optional(Type.Enum(['down', 'up'])),
    modifiers: Type.Optional(Type.Integer({ minimum: 0, maximum: 15 })),
    repeat: Type.Optional(Type.Boolean()) }, {
    additionalProperties: false,
  }),
  Type.Object(
    { kind: Type.Literal('scroll'), dy: Type.Integer({ minimum: -10_000, maximum: 10_000 }),
      dx: Type.Optional(Type.Integer({ minimum: -10_000, maximum: 10_000 })),
      x: Type.Optional(Px), y: Type.Optional(Px) },
    { additionalProperties: false },
  ),
  Type.Object({ kind: Type.Literal('back') }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('forward') }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('reload') }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('stop') }, { additionalProperties: false }),
]);
export type BrowserActionInput = Static<typeof BrowserActionInputSchema>;

export const BrowserActionRequestSchema = Type.Object(
  { requestId: RequestIdSchema, instanceId: Type.Optional(Type.String()),
    tabId: Type.String({ minLength: 1, maxLength: 200 }), action: BrowserActionInputSchema },
  { additionalProperties: false },
);
export type BrowserActionRequest = Static<typeof BrowserActionRequestSchema>;
export const BrowserActionResponseSchema = Type.Object({
  browser: BrowserViewSchema,
  outcome: Type.Enum(['done', 'dry_run']),
});
export type BrowserActionResponse = Static<typeof BrowserActionResponseSchema>;

export const BrowserTabActionSchema = Type.Union([
  Type.Object({ kind: Type.Literal('new') }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('close_all') }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('clear_login') }, { additionalProperties: false }),
  Type.Object({ kind: Type.Enum(['switch', 'close']), tabId: Type.String({ minLength: 1, maxLength: 200 }) },
    { additionalProperties: false }),
]);
export type BrowserTabAction = Static<typeof BrowserTabActionSchema>;
export const BrowserTabRequestSchema = Type.Object({ requestId: RequestIdSchema,
  instanceId: Type.Optional(Type.String()), action: BrowserTabActionSchema }, { additionalProperties: false });
export type BrowserTabRequest = Static<typeof BrowserTabRequestSchema>;

export const BrowserFrameSchema = Type.Object({
  sequence: Type.Integer({ minimum: 1 }), tabId: Type.String(),
  data: Type.String({ maxLength: 4_000_000, pattern: '^[A-Za-z0-9+/=]+$' }),
  width: Type.Number({ exclusiveMinimum: 0, maximum: FRAME_MAX }),
  height: Type.Number({ exclusiveMinimum: 0, maximum: FRAME_MAX }),
});
export type BrowserFrame = Static<typeof BrowserFrameSchema>;
export const BrowserStreamEventSchema = Type.Union([
  Type.Object({ type: Type.Literal('frame'), frame: BrowserFrameSchema }),
  Type.Object({ type: Type.Literal('status'), browser: BrowserViewSchema }),
  Type.Object({ type: Type.Literal('unavailable'), message: Type.String() }),
]);
export type BrowserStreamEvent = Static<typeof BrowserStreamEventSchema>;
export const BrowserViewportSchema = Type.Object({
  width: Type.Integer({ minimum: 1, maximum: FRAME_MAX }),
  height: Type.Integer({ minimum: 1, maximum: FRAME_MAX }),
  deviceScaleFactor: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 2 })),
});
export type BrowserViewport = Static<typeof BrowserViewportSchema>;
export const BrowserStreamQuerySchema = Type.Object({
  ...BrowserViewportSchema.properties,
  streamId: Type.String({ minLength: 1, maxLength: 100, pattern: '^[a-zA-Z0-9_-]+$' }),
});
export type BrowserStreamQuery = Static<typeof BrowserStreamQuerySchema>;
export const BrowserAckSchema = Type.Object({
  streamId: Type.String({ minLength: 1, maxLength: 100 }), sequence: Type.Integer({ minimum: 1 }),
}, { additionalProperties: false });
export type BrowserAck = Static<typeof BrowserAckSchema>;
export const BrowserAckResponseSchema = Type.Object({ ok: Type.Boolean() });

export const SettleActionRequestSchema = Type.Object(
  { requestId: RequestIdSchema, happened: Type.Boolean() },
  { additionalProperties: false },
);
export type SettleActionRequest = Static<typeof SettleActionRequestSchema>;
export const SettleActionResponseSchema = Type.Object({
  status: Type.Enum(['issued', 'succeeded', 'failed', 'unknown', 'dry_run']),
});
export type SettleActionResponse = Static<typeof SettleActionResponseSchema>;
