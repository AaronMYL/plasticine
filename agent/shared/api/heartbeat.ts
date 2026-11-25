import { Type, type Static } from 'typebox';
import { API_PREFIX, IsoTimeSchema, RequestIdSchema } from './common.ts';
import { OrNull } from './lineage.ts';

const STRICT = { additionalProperties: false };

export const HEARTBEAT_PATH = `${API_PREFIX}/heartbeat`;
export const HEARTBEAT_SAY_PATH = `${HEARTBEAT_PATH}/say`;

export const HEARTBEAT_ITEM_KINDS = [
  'mail', 'calendar', 'waiting', 'results', 'friends', 'due', 'feed', 'custom',
] as const;
export type HeartbeatItemKind = (typeof HEARTBEAT_ITEM_KINDS)[number];
export const HEARTBEAT_ITEMS_MAX = 12;
export const HEARTBEAT_ITEM_MAX_CHARS = 60;
export const HEARTBEAT_INTERVALS = [15, 30, 60, 120] as const;

const Clock = Type.String({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' });

export const HeartbeatItemSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 40 }),
  kind: Type.Enum(HEARTBEAT_ITEM_KINDS),
  text: Type.String({ minLength: 1, maxLength: HEARTBEAT_ITEM_MAX_CHARS }),
}, STRICT);
export type HeartbeatItem = Static<typeof HeartbeatItemSchema>;

export const HeartbeatConfigSchema = Type.Object({
  intervalMinutes: Type.Union([Type.Literal(15), Type.Literal(30), Type.Literal(60), Type.Literal(120)]),
  quietFrom: Clock,
  quietTo: Clock,
  items: Type.Array(HeartbeatItemSchema, { maxItems: HEARTBEAT_ITEMS_MAX }),
}, STRICT);
export type HeartbeatConfig = Static<typeof HeartbeatConfigSchema>;

export const HeartbeatBeatViewSchema = Type.Object({
  at: IsoTimeSchema,
  note: Type.String(),
  failed: Type.Boolean(),
}, STRICT);

/** GET /v2/heartbeat */
export const HeartbeatViewSchema = Type.Object({
  enabled: Type.Boolean(),
  config: HeartbeatConfigSchema,
  nextAt: OrNull(IsoTimeSchema),
  recent: Type.Array(HeartbeatBeatViewSchema),
}, STRICT);
export type HeartbeatView = Static<typeof HeartbeatViewSchema>;

export const UpdateHeartbeatRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  intervalMinutes: Type.Optional(HeartbeatConfigSchema.properties.intervalMinutes),
  quietFrom: Type.Optional(Clock),
  quietTo: Type.Optional(Clock),
  items: Type.Optional(Type.Array(Type.Object({
    id: Type.Optional(Type.String({ minLength: 1, maxLength: 40 })),
    text: Type.String({ minLength: 1, maxLength: HEARTBEAT_ITEM_MAX_CHARS }),
  }, STRICT), { maxItems: HEARTBEAT_ITEMS_MAX })),
}, STRICT);
export type UpdateHeartbeatRequest = Static<typeof UpdateHeartbeatRequestSchema>;

export const HeartbeatSayRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  text: Type.String({ minLength: 1, maxLength: 300 }),
}, STRICT);
export type HeartbeatSayRequest = Static<typeof HeartbeatSayRequestSchema>;
