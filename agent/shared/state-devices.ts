import { Type, type Static } from 'typebox';
import { HashSchema } from './state-access.ts';
import { CONFIRMATION_META, IdSchema, IsoTimeSchema, Nullable, RECORD_META } from './state-common.ts';

const STRICT = { additionalProperties: false };

export const DEVICE_ACTION_KINDS = [
  'file_list',
  'file_read',
  'file_write',
  'file_delete',
  'run_command',
  'browser_open',
  'browser_read',
  'screen_capture',
  'input_click',
  'input_type',
  'app_open',
  'tab_list',
  'tab_read',
  'tab_open',
  'tab_navigate',
  'tab_click',
  'tab_fill',
  'tab_perceive',
  'tab_act',
  'tab_shot',
  'tab_point',
  'tab_type',
  'tab_close',
  'tab_wait',
  'tab_key',
  'tab_scroll',
  'tab_paste',
  'tab_show',
  'tab_upload',
  'file_fetch',
  'file_put',
  'device_state',
  'clipboard_read',
  'clipboard_write',
  'folder_request',
  'file_find',
  'open_in_app',
  'app_script',
  'shortcut_list',
  'calendar_update',
  'tab_hover',
  'tab_drag',
  'tab_downloads',
  'tab_dialog',
  'input_key',
  'input_scroll',
  'input_mouse',
  'screen_zoom',
  'window_capture',
  'app_list',
  'window_list',
  'window_act',
  'app_perceive',
  'app_act',
  'app_menu',
  'calendar_list',
  'calendar_create',
  'reminder_list',
  'reminder_create',
  'reminder_complete',
  'shortcut_run',
] as const;
export const DeviceActionKindSchema = Type.Enum(DEVICE_ACTION_KINDS);
export type DeviceActionKind = Static<typeof DeviceActionKindSchema>;

export const DEVICE_ACTION_CLASSES = ['read', 'write', 'delete', 'command', 'browser', 'input'] as const;
export const DeviceActionClassSchema = Type.Enum(DEVICE_ACTION_CLASSES);
export type DeviceActionClass = Static<typeof DeviceActionClassSchema>;

export const DEVICE_CLASS_MODES = ['allow', 'confirm_each', 'deny'] as const;
export const DeviceClassModeSchema = Type.Enum(DEVICE_CLASS_MODES);
export type DeviceClassMode = Static<typeof DeviceClassModeSchema>;

export const DEVICE_PER_HOUR_MAX = 10_000;
export const DEVICE_SCOPE_ITEMS_MAX = 50;
export const DEVICE_SCOPE_ITEM_MAX_CHARS = 400;

const ScopeItem = Type.String({ minLength: 1, maxLength: DEVICE_SCOPE_ITEM_MAX_CHARS });
const ScopeList = Type.Array(ScopeItem, { maxItems: DEVICE_SCOPE_ITEMS_MAX });

export const DeviceClassLimitSchema = Type.Object(
  { mode: DeviceClassModeSchema, perHour: Type.Integer({ minimum: 0, maximum: DEVICE_PER_HOUR_MAX }) },
  STRICT,
);

export const DeviceLimitsSchema = Type.Object(
  {
    roots: ScopeList,
    apps: ScopeList,
    sites: ScopeList,
    unattendedInput: Type.Boolean(),
    payments: Type.Optional(Type.Enum(['deny', 'confirm_each'])),
    classes: Type.Object(
      {
        read: DeviceClassLimitSchema,
        write: DeviceClassLimitSchema,
        delete: DeviceClassLimitSchema,
        command: DeviceClassLimitSchema,
        browser: DeviceClassLimitSchema,
        input: DeviceClassLimitSchema,
      },
      STRICT,
    ),
  },
  STRICT,
);
export type DeviceLimits = Static<typeof DeviceLimitsSchema>;

export const NODE_PLATFORMS = ['macos', 'ios', 'windows', 'linux', 'browser'] as const;
export const NodePlatformSchema = Type.Enum(NODE_PLATFORMS);

const COMPUTER_PLATFORMS: readonly string[] = ['macos', 'windows', 'linux'];
export function isComputerPlatform(platform: string): boolean {
  return COMPUTER_PLATFORMS.includes(platform);
}

export const NODE_NAME_MAX_CHARS = 60;
export const NodeNameSchema = Type.String({ minLength: 1, maxLength: NODE_NAME_MAX_CHARS });
export const NodeVersionSchema = Type.String({ minLength: 1, maxLength: 40 });
export const NodeCapabilitiesSchema = Type.Array(DeviceActionKindSchema, { uniqueItems: true });

export const NodeInputSchema = Type.Object(
  {
    name: NodeNameSchema,
    platform: NodePlatformSchema,
    appVersion: NodeVersionSchema,
    protocolVersion: Type.Integer({ minimum: 1 }),
    capabilities: NodeCapabilitiesSchema,
    credentialHash: HashSchema,
    pairingCodeId: IdSchema,
    pairedAt: IsoTimeSchema,
    lastSeenAt: IsoTimeSchema,
  },
  STRICT,
);
export type NodeInput = Static<typeof NodeInputSchema>;
export const NODE_IDLE_SECONDS_MAX = 864_000;
const IdleSeconds = Type.Integer({ minimum: 0, maximum: NODE_IDLE_SECONDS_MAX });

export const NodePatchSchema = Type.Partial(
  Type.Object({
    name: NodeNameSchema,
    appVersion: NodeVersionSchema,
    protocolVersion: Type.Integer({ minimum: 1 }),
    capabilities: NodeCapabilitiesSchema,
    credentialHash: HashSchema,
    lastSeenAt: IsoTimeSchema,
    revokedAt: Nullable(IsoTimeSchema),
    idleSeconds: Nullable(IdleSeconds),
    idleReportedAt: Nullable(IsoTimeSchema),
  }),
  STRICT,
);
export type NodePatch = Static<typeof NodePatchSchema>;
export const NodeConfirmedSchema = Type.Object(
  { limits: DeviceLimitsSchema, limitsVersion: Type.Integer({ minimum: 1 }) },
  STRICT,
);
export type NodeConfirmed = Static<typeof NodeConfirmedSchema>;
export const NodeSchema = Type.Object({
  ...RECORD_META,
  ...NodeInputSchema.properties,
  revokedAt: Nullable(IsoTimeSchema),
  limits: Nullable(DeviceLimitsSchema),
  limitsVersion: Type.Integer({ minimum: 0 }),
  idleSeconds: Nullable(IdleSeconds),
  idleReportedAt: Nullable(IsoTimeSchema),
  ...CONFIRMATION_META,
});
export type DeviceNode = Static<typeof NodeSchema>;

export const NodePairingCodeInputSchema = Type.Object(
  { codeHash: HashSchema, expiresAt: IsoTimeSchema, issuedByDeviceId: IdSchema },
  STRICT,
);
export type NodePairingCodeInput = Static<typeof NodePairingCodeInputSchema>;
export const NodePairingCodePatchSchema = Type.Partial(
  Type.Object({ usedAt: IsoTimeSchema, nodeId: IdSchema, voidedAt: IsoTimeSchema }),
  STRICT,
);
export const NodePairingCodeSchema = Type.Object({
  ...RECORD_META,
  ...NodePairingCodeInputSchema.properties,
  usedAt: Nullable(IsoTimeSchema),
  nodeId: Nullable(IdSchema),
  voidedAt: Nullable(IsoTimeSchema),
});
export type NodePairingCode = Static<typeof NodePairingCodeSchema>;

export const NODE_ACTION_STATUSES = ['queued', 'sent', 'executed', 'failed', 'refused', 'unknown', 'dry_run'] as const;
export const NodeActionStatusSchema = Type.Enum(NODE_ACTION_STATUSES);
export type NodeActionStatus = Static<typeof NodeActionStatusSchema>;

export const NODE_REFUSAL_LAYERS = [
  'protected',
  'class',
  'scope',
  'count',
  'confirm',
  'unattended',
  'node',
  'params',
  'device',
] as const;
export const NodeRefusalLayerSchema = Type.Enum(NODE_REFUSAL_LAYERS);
export type NodeRefusalLayer = Static<typeof NodeRefusalLayerSchema>;

export const NODE_ACTION_ORIGINS = ['brain', 'user', 'system'] as const;
export const NODE_ACTION_TARGET_MAX_CHARS = 300;
export const NODE_ACTION_PURPOSE_MAX_CHARS = 300;

export const NodeActionInputSchema = Type.Object(
  {
    actionId: IdSchema,
    nodeId: IdSchema,
    kind: DeviceActionKindSchema,
    actionClass: DeviceActionClassSchema,
    target: Type.String({ maxLength: NODE_ACTION_TARGET_MAX_CHARS }),
    paramsDigest: HashSchema,
    status: NodeActionStatusSchema,
    origin: Type.Enum(NODE_ACTION_ORIGINS),
    requestedAt: IsoTimeSchema,
    refusalLayer: Type.Optional(Nullable(NodeRefusalLayerSchema)),
    reason: Type.Optional(Nullable(Type.String())),
    taskId: Type.Optional(Nullable(IdSchema)),
    runId: Type.Optional(Nullable(IdSchema)),
    /** Durable dispatch data, validated as NodeActionEnvelope by devices/ before delivery. */
    envelope: Type.Optional(Nullable(Type.Unknown())),
    deadline: Type.Optional(Nullable(IsoTimeSchema)),
    purpose: Type.Optional(Nullable(Type.String({ maxLength: NODE_ACTION_PURPOSE_MAX_CHARS }))),
  },
  STRICT,
);
export type NodeActionInput = Static<typeof NodeActionInputSchema>;
export const NodeActionPatchSchema = Type.Partial(
  Type.Object({
    status: NodeActionStatusSchema,
    refusalLayer: Nullable(NodeRefusalLayerSchema),
    reason: Nullable(Type.String()),
    result: Nullable(Type.Unknown()),
    deliveredAt: Nullable(IsoTimeSchema),
    executedAt: Nullable(IsoTimeSchema),
    envelope: Nullable(Type.Unknown()),
    deadline: Nullable(IsoTimeSchema),
    reportDigest: Nullable(HashSchema),
  }),
  STRICT,
);
export type NodeActionPatch = Static<typeof NodeActionPatchSchema>;
export const NodeActionSchema = Type.Object({
  ...RECORD_META,
  ...Type.Required(NodeActionInputSchema).properties,
  result: Nullable(Type.Unknown()),
  deliveredAt: Nullable(IsoTimeSchema),
  executedAt: Nullable(IsoTimeSchema),
  reportDigest: Nullable(HashSchema),
});
export type NodeAction = Static<typeof NodeActionSchema>;
