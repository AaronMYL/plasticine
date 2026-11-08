// M5 设备服务的状态（《应用架构方案》第 4、8、10 节）：执行节点（Mac / 浏览器上的设备服务，和登录用的 devices 不是一回事：
// App 登录身份与设备执行身份分别管理）、节点的一次性配对码、每个设备动作的一行记录，以及设备侧上限。
// 节点的长期凭证和配对码都只存 SHA-256 散列（HashSchema）；明文只出现在一次配对回答和设备本机。
// 上限是用户确认字段：只能经本人配对会话的确认写入，模型工具写不到。Import from shared/state.ts.

import { Type, type Static } from 'typebox';
import { HashSchema } from './state-access.ts';
import { CONFIRMATION_META, IdSchema, IsoTimeSchema, Nullable, RECORD_META } from './state-common.ts';

const STRICT = { additionalProperties: false };

/**
 * 《应用架构方案》第 4 节的工具类别落成动作。参数由云端给齐，设备不补判断（参数 schema 在 shared/api/devices.ts）。
 */
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
  // 第 102 条第 3 批：Mac 原生壳里的网页标签（用户自己登录着的 WKWebView）。读、开、走、点、填都按 DOM 做，不动真鼠标。
  'tab_list',
  'tab_read',
  'tab_open',
  'tab_navigate',
  'tab_click',
  'tab_fill',
  // 第 3 批「问这一页 → 操作整页」：感知整页（页面结构 + 带编号的元素）、按编号点 / 填 / 选 / 回车 / 翻页；提交前问他。
  'tab_perceive',
  'tab_act',
  // 第 102 条第 4 批：iPhone 的手（日历与提醒事项、相册、快捷指令、位置；文件沿用上面的 file_* 三种）。
  'calendar_list',
  'calendar_create',
  'reminder_list',
  'reminder_create',
  'reminder_complete',
  'photo_list',
  'photo_read',
  'shortcut_run',
  'location_current',
] as const;
export const DeviceActionKindSchema = Type.Enum(DEVICE_ACTION_KINDS);
export type DeviceActionKind = Static<typeof DeviceActionKindSchema>;

/** 第 8 节第 2 层的「可执行的动作类（读 / 写 / 删 / 运行命令 / 浏览器站点 / 点击输入）」。 */
export const DEVICE_ACTION_CLASSES = ['read', 'write', 'delete', 'command', 'browser', 'input'] as const;
export const DeviceActionClassSchema = Type.Enum(DEVICE_ACTION_CLASSES);
export type DeviceActionClass = Static<typeof DeviceActionClassSchema>;

/** allow 上限内照做 · confirm_each 每次都要你在设备上点（删除默认是这个）· deny 这一类一律拒。 */
export const DEVICE_CLASS_MODES = ['allow', 'confirm_each', 'deny'] as const;
export const DeviceClassModeSchema = Type.Enum(DEVICE_CLASS_MODES);
export type DeviceClassMode = Static<typeof DeviceClassModeSchema>;

// 一个小时最多几次：一台电脑一小时内超过一万次同类动作已经不是正常使用，这里只给 schema 一个硬顶。
export const DEVICE_PER_HOUR_MAX = 10_000;
export const DEVICE_SCOPE_ITEMS_MAX = 50;
export const DEVICE_SCOPE_ITEM_MAX_CHARS = 400;

const ScopeItem = Type.String({ minLength: 1, maxLength: DEVICE_SCOPE_ITEM_MAX_CHARS });
const ScopeList = Type.Array(ScopeItem, { maxItems: DEVICE_SCOPE_ITEMS_MAX });

export const DeviceClassLimitSchema = Type.Object(
  { mode: DeviceClassModeSchema, perHour: Type.Integer({ minimum: 0, maximum: DEVICE_PER_HOUR_MAX }) },
  STRICT,
);
export type DeviceClassLimit = Static<typeof DeviceClassLimitSchema>;

/**
 * 设备侧上限（第 8 节第 2 层）：目录范围（roots，读写删和命令的工作目录都只在这些目录里）、可调用的应用、浏览器站点（逐站
 * 授权）、无人时可不可以点击输入、每类动作的方式和每小时次数。云端的任何约定、提示词都放不宽它。
 */
export const DeviceLimitsSchema = Type.Object(
  {
    roots: ScopeList,
    apps: ScopeList,
    sites: ScopeList,
    unattendedInput: Type.Boolean(),
    // 第 102 条「关死」：付款、下单、转账一律拒（缺省）。只有用户在已配对页面改上限才能放开到「每次要你点」，云端放不宽。
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
export type NodePlatform = Static<typeof NodePlatformSchema>;

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
// hello 可选上报的用户最近一次键鼠活动（空闲秒数）：用户在用时点击 / 输入等着（第 102 条「用户在场让路」）。
// 十天以上就当很久没动了，只给 schema 一个硬顶。
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
/** 上限是确认字段：null / 0 是「还在用默认上限」，由本人会话确认修改。 */
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
  // 迁移 0040：旧 App 不报，两项都是 null，照现状执行。
  idleSeconds: Nullable(IdleSeconds),
  idleReportedAt: Nullable(IsoTimeSchema),
  ...CONFIRMATION_META,
});
export type DeviceNode = Static<typeof NodeSchema>;

/** 节点配对码：作废（voidedAt）是同一次签发请求重发时换了新码，旧码不能再用。 */
export const NodePairingCodeInputSchema = Type.Object(
  { codeHash: HashSchema, expiresAt: IsoTimeSchema, issuedByDeviceId: IdSchema },
  STRICT,
);
export type NodePairingCodeInput = Static<typeof NodePairingCodeInputSchema>;
export const NodePairingCodePatchSchema = Type.Partial(
  Type.Object({ usedAt: IsoTimeSchema, nodeId: IdSchema, voidedAt: IsoTimeSchema }),
  STRICT,
);
export type NodePairingCodePatch = Static<typeof NodePairingCodePatchSchema>;
export const NodePairingCodeSchema = Type.Object({
  ...RECORD_META,
  ...NodePairingCodeInputSchema.properties,
  usedAt: Nullable(IsoTimeSchema),
  nodeId: Nullable(IdSchema),
  voidedAt: Nullable(IsoTimeSchema),
});
export type NodePairingCode = Static<typeof NodePairingCodeSchema>;

/**
 * 一个设备动作的状态：sent 已发给节点、还没回执（重放时算结果不明，不再发）· executed 节点做了 · failed 节点说没做成 ·
 * refused 被拒（受保护路径、上限、节点撤销……，没有发出）· unknown 发出后断了，说不清做没做 · dry_run 开发期只记录。
 */
export const NODE_ACTION_STATUSES = ['queued', 'sent', 'executed', 'failed', 'refused', 'unknown', 'dry_run'] as const;
export const NodeActionStatusSchema = Type.Enum(NODE_ACTION_STATUSES);
export type NodeActionStatus = Static<typeof NodeActionStatusSchema>;

/**
 * 被哪一层拒（第 8 节「任何一层不满足都报告具体是哪一层」）：protected 受保护路径 · class 这一类不许 · scope 不在授权
 * 范围 · count 超过每小时次数 · confirm 要你逐次确认 · unattended 无人时不许点击输入 · node 节点不可用（撤销、没配对、
 * 不支持）· params 参数不全或不对 · device 节点自己按它的上限拒了。
 */
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
// 一行动作记录里给人看的目标（路径、网址、应用名，命令截短），不放写入的内容。
export const NODE_ACTION_TARGET_MAX_CHARS = 300;
// 用途一两句话。
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
    // 迁移 0040：模型交办这个动作时写明的用途（第 102 条：代码按用途 + 参数判道）。不发给设备。
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
