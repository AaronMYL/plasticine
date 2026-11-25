import { Type, type Static } from 'typebox';
import {
  DeviceActionClassSchema,
  DeviceActionKindSchema,
  DeviceLimitsSchema,
  DeviceNameSchema,
  NODE_ACTION_ORIGINS,
  NodeActionStatusSchema,
  NodeCapabilitiesSchema,
  NodeNameSchema,
  NodePlatformSchema,
  NodeRefusalLayerSchema,
  NodeVersionSchema,
  NODE_IDLE_SECONDS_MAX,
  type DeviceActionClass,
  type DeviceActionKind,
  type NodeRefusalLayer,
} from '../state.ts';
import { API_PREFIX, IdSchema, IsoTimeSchema, RequestIdSchema } from './common.ts';
import { DevicePathSchema, HAND_ACTION_PARAM_SCHEMAS, HAND_KIND_CLASSES, HAND_KIND_LABELS,
  WebTabIdSchema } from './device-hands.ts';
import { DESK_ACTION_PARAM_SCHEMAS, DESK_KIND_CLASSES, DESK_KIND_LABELS } from './device-desk.ts';
import { IOS_ACTION_PARAM_SCHEMAS, IOS_KIND_CLASSES, IOS_KIND_LABELS } from './device-ios.ts';
import { OrNull } from './lineage.ts';
import { PAGE_STEP_MAX_CHARS, PageActSchema } from './page-operate.ts';

export const DEVICES_PATH = `${API_PREFIX}/devices`;

export const DeviceViaSchema = Type.Union([Type.Literal('local'), Type.Literal('direct'), Type.Literal('relay'),
  Type.Literal('web')]);
export type DeviceVia = Static<typeof DeviceViaSchema>;

export const DeviceViewSchema = Type.Object({
  id: IdSchema,
  name: DeviceNameSchema,
  firstSeenAt: IsoTimeSchema,
  lastSeenAt: IsoTimeSchema,
  revokedAt: Type.Union([IsoTimeSchema, Type.Null()]),
  /** The device this request came from. */
  current: Type.Boolean(),
  local: Type.Optional(Type.Boolean()),
  via: Type.Optional(DeviceViaSchema),
});
export type DeviceView = Static<typeof DeviceViewSchema>;

/** GET /v2/devices */
export const DeviceListResponseSchema = Type.Object({ devices: Type.Array(DeviceViewSchema) });
export type DeviceListResponse = Static<typeof DeviceListResponseSchema>;

/** DELETE /v2/devices/:id — revoking the current device logs this browser out as well. */
export const RevokeDeviceResponseSchema = Type.Object({ device: DeviceViewSchema });
export type RevokeDeviceResponse = Static<typeof RevokeDeviceResponseSchema>;

export const NODES_PATH = `${API_PREFIX}/nodes`;
export const NODE_PAIR_PATH = `${NODES_PATH}/pair`;
export const NODE_HELLO_PATH = `${NODES_PATH}/hello`;
export const NODE_PAIRING_CODES_PATH = `${NODES_PATH}/pairing-codes`;
export const NODE_PROTOCOL_VERSION = 1;
/** The node's credential goes in `authorization: Bearer …`, never in a URL or a body. */
export const NODE_CREDENTIAL_SCHEME = 'Bearer';

export const TAB_WAIT_MAX_SECONDS = 30;

export const DEVICE_CLASS_LABELS: Readonly<Record<DeviceActionClass, string>> = {
  read: '读取',
  write: '写入',
  delete: '删除',
  command: '运行命令',
  browser: '浏览器站点',
  input: '点击输入',
};

export const DEVICE_KIND_LABELS: Readonly<Record<DeviceActionKind, string>> = {
  file_list: '列目录',
  file_read: '读文件',
  file_write: '写回文件',
  file_delete: '删文件',
  run_command: '运行命令',
  browser_open: '打开网页',
  browser_read: '读网页文字',
  screen_capture: '截图',
  input_click: '点击',
  input_type: '输入文字',
  app_open: '打开应用',
  tab_list: '列网页标签',
  tab_read: '读网页标签',
  tab_open: '开网页标签',
  tab_navigate: '网页标签换地址',
  tab_click: '在网页标签里点',
  tab_fill: '在网页标签里填',
  tab_perceive: '看整页',
  tab_act: '在网页上操作',
  tab_shot: '截网页标签',
  tab_close: '关网页标签',
  tab_wait: '等网页标签',
  tab_point: '在网页标签里按位置点',
  tab_type: '在网页标签里打字',
  ...HAND_KIND_LABELS,
  ...DESK_KIND_LABELS,
  ...IOS_KIND_LABELS,
};

export const REFUSAL_LAYER_LABELS: Readonly<Record<NodeRefusalLayer, string>> = {
  protected: '受保护路径',
  class: '这一类动作不许',
  scope: '不在授权范围',
  count: '超过每小时次数',
  confirm: '要你逐次确认',
  unattended: '无人时不许点击输入',
  node: '节点不可用',
  params: '参数不全',
  device: '设备自己拒了',
};

export const DEVICE_KIND_CLASSES: Readonly<Record<DeviceActionKind, DeviceActionClass>> = {
  file_list: 'read',
  file_read: 'read',
  file_write: 'write',
  file_delete: 'delete',
  run_command: 'command',
  browser_open: 'browser',
  browser_read: 'browser',
  screen_capture: 'input',
  input_click: 'input',
  input_type: 'input',
  app_open: 'input',
  tab_list: 'browser',
  tab_read: 'browser',
  tab_open: 'browser',
  tab_navigate: 'browser',
  tab_click: 'input',
  tab_fill: 'input',
  tab_perceive: 'browser',
  tab_act: 'input',
  tab_shot: 'browser',
  tab_close: 'browser',
  tab_wait: 'browser',
  tab_point: 'input',
  tab_type: 'input',
  ...HAND_KIND_CLASSES,
  ...DESK_KIND_CLASSES,
  ...IOS_KIND_CLASSES,
};

const STRICT = { additionalProperties: false };
export { DEVICE_FILE_MAX_BYTES, DevicePathSchema, TAB_KEY_PATTERN, TAB_PASTE_MAX_CHARS, TAB_UPLOAD_FILES_MAX,
  WebTabIdSchema } from './device-hands.ts';
export const DEVICE_WRITE_MAX_CHARS = 400_000;
export const DEVICE_COMMAND_MAX_CHARS = 4_000;
const UrlSchema = Type.String({ pattern: '^https?://', maxLength: 2_048 });
export const TAB_SELECTOR_MAX_CHARS = 500;
export const TAB_CLICK_TEXT_MAX_CHARS = 200;
export const TAB_FILL_MAX_CHARS = 4_000;
const SelectorSchema = Type.String({ minLength: 1, maxLength: TAB_SELECTOR_MAX_CHARS });

export const DeviceActionParamsSchema = Type.Union([
  Type.Object({ kind: Type.Literal('file_list'), path: DevicePathSchema }, STRICT),
  Type.Object({ kind: Type.Literal('file_read'), path: DevicePathSchema }, STRICT),
  Type.Object(
    {
      kind: Type.Literal('file_write'),
      path: DevicePathSchema,
      content: Type.String({ maxLength: DEVICE_WRITE_MAX_CHARS }),
      baseVersion: OrNull(Type.String({ minLength: 1 })),
    },
    STRICT,
  ),
  Type.Object({ kind: Type.Literal('file_delete'), path: DevicePathSchema }, STRICT),
  Type.Object(
    {
      kind: Type.Literal('run_command'),
      cwd: DevicePathSchema,
      command: Type.String({ minLength: 1, maxLength: DEVICE_COMMAND_MAX_CHARS }),
    },
    STRICT,
  ),
  Type.Object({ kind: Type.Literal('browser_open'), url: UrlSchema }, STRICT),
  Type.Object({ kind: Type.Literal('browser_read'), url: UrlSchema }, STRICT),
  Type.Object({ kind: Type.Literal('screen_capture') }, STRICT),
  Type.Object(
    { kind: Type.Literal('input_click'), x: Type.Integer({ minimum: 0 }), y: Type.Integer({ minimum: 0 }) },
    STRICT,
  ),
  Type.Object({ kind: Type.Literal('input_type'), text: Type.String({ minLength: 1, maxLength: 4_000 }) }, STRICT),
  Type.Object({ kind: Type.Literal('app_open'), app: Type.String({ minLength: 1, maxLength: 200 }) }, STRICT),
  Type.Object({ kind: Type.Literal('tab_list') }, STRICT),
  Type.Object({ kind: Type.Literal('tab_read'), tabId: WebTabIdSchema, offset: Type.Integer({ minimum: 0 }) }, STRICT),
  Type.Object({ kind: Type.Literal('tab_open'), url: UrlSchema }, STRICT),
  Type.Object({ kind: Type.Literal('tab_navigate'), tabId: WebTabIdSchema, url: UrlSchema }, STRICT),
  Type.Object(
    {
      kind: Type.Literal('tab_click'),
      tabId: WebTabIdSchema,
      selector: OrNull(SelectorSchema),
      text: OrNull(Type.String({ minLength: 1, maxLength: TAB_CLICK_TEXT_MAX_CHARS })),
    },
    STRICT,
  ),
  Type.Object(
    {
      kind: Type.Literal('tab_fill'),
      tabId: WebTabIdSchema,
      selector: SelectorSchema,
      value: Type.String({ maxLength: TAB_FILL_MAX_CHARS }),
    },
    STRICT,
  ),
  Type.Object({ kind: Type.Literal('tab_perceive'), tabId: WebTabIdSchema }, STRICT),
  Type.Object(
    {
      kind: Type.Literal('tab_act'),
      tabId: WebTabIdSchema,
      version: Type.String({ minLength: 1, maxLength: 40 }),
      act: PageActSchema,
      step: Type.String({ minLength: 2, maxLength: PAGE_STEP_MAX_CHARS }),
      submitAsk: OrNull(IdSchema),
    },
    STRICT,
  ),
  Type.Object({ kind: Type.Literal('tab_shot'), tabId: WebTabIdSchema }, STRICT),
  Type.Object({ kind: Type.Literal('tab_point'), tabId: WebTabIdSchema, x: Type.Integer({ minimum: 0 }),
    y: Type.Integer({ minimum: 0 }) }, STRICT),
  Type.Object({ kind: Type.Literal('tab_type'), tabId: WebTabIdSchema,
    text: Type.String({ minLength: 1, maxLength: TAB_FILL_MAX_CHARS }) }, STRICT),
  Type.Object({ kind: Type.Literal('tab_close'), tabId: WebTabIdSchema }, STRICT),
  Type.Object({ kind: Type.Literal('tab_wait'), tabId: WebTabIdSchema,
    text: Type.String({ minLength: 1, maxLength: 200 }), gone: Type.Optional(Type.Boolean()),
    timeoutSeconds: Type.Integer({ minimum: 1, maximum: TAB_WAIT_MAX_SECONDS }) }, STRICT),
  ...HAND_ACTION_PARAM_SCHEMAS,
  ...DESK_ACTION_PARAM_SCHEMAS,
  ...IOS_ACTION_PARAM_SCHEMAS,
]);
export type DeviceActionParams = Static<typeof DeviceActionParamsSchema>;

/** POST /v2/nodes/pair (no session; the code is the proof) → 201 NodePairResponse. */
export const NodePairRequestSchema = Type.Object(
  {
    requestId: RequestIdSchema,
    code: Type.String({ minLength: 4, maxLength: 20 }),
    name: NodeNameSchema,
    platform: NodePlatformSchema,
    appVersion: NodeVersionSchema,
    protocolVersion: Type.Integer({ minimum: 1 }),
    capabilities: NodeCapabilitiesSchema,
  },
  STRICT,
);
export type NodePairRequest = Static<typeof NodePairRequestSchema>;

export const NodePairResponseSchema = Type.Object({
  nodeId: IdSchema,
  /** Shown once; the device keeps it in its own protected store (Mac: owner-only file; iPhone: keychain). */
  credential: Type.String({ minLength: 1 }),
  limits: DeviceLimitsSchema,
  limitsVersion: Type.Integer({ minimum: 0 }),
});
export type NodePairResponse = Static<typeof NodePairResponseSchema>;

export const NodeBusySchema = Type.Object({
  actionId: IdSchema,
  kind: DeviceActionKindSchema,
  step: Type.String({ maxLength: 200 }),
  since: IsoTimeSchema,
}, STRICT);
export type NodeBusy = Static<typeof NodeBusySchema>;

/** POST /v2/nodes/hello (Bearer credential) → 200 NodeHelloResponse. */
export const NodeHelloRequestSchema = Type.Object(
  {
    appVersion: NodeVersionSchema,
    protocolVersion: Type.Integer({ minimum: 1 }),
    capabilities: NodeCapabilitiesSchema,
    idleSeconds: Type.Optional(Type.Integer({ minimum: 0, maximum: NODE_IDLE_SECONDS_MAX })),
    busy: Type.Optional(NodeBusySchema),
  },
  STRICT,
);
export type NodeHelloRequest = Static<typeof NodeHelloRequestSchema>;

export const NodeHelloResponseSchema = Type.Object({
  nodeId: IdSchema,
  limits: DeviceLimitsSchema,
  limitsVersion: Type.Integer({ minimum: 0 }),
  logsWanted: Type.Optional(Type.Object({ requestId: IdSchema, since: IsoTimeSchema }, STRICT)),
  cancel: Type.Optional(Type.Array(IdSchema, { maxItems: 50 })),
});
export type NodeHelloResponse = Static<typeof NodeHelloResponseSchema>;

export const NODE_LOGS_PATH = `${NODES_PATH}/logs`;
export const NODE_LOG_LINES_MAX = 3_000;
export const NODE_LOG_TEXT_MAX = 1_000;
export const NODE_LOGS_MAX_BYTES = 10 * 1024 * 1024;
export const NodeLogUploadSchema = Type.Object({
  requestId: IdSchema,
  lines: Type.Array(Type.Object({ at: IsoTimeSchema, text: Type.String({ maxLength: NODE_LOG_TEXT_MAX }) }, STRICT),
    { maxItems: NODE_LOG_LINES_MAX }),
  truncated: Type.Boolean(),
}, STRICT);
export type NodeLogUpload = Static<typeof NodeLogUploadSchema>;

/** What the cloud sends a node for one action. */
export const NodeActionEnvelopeSchema = Type.Object(
  {
    protocolVersion: Type.Integer({ minimum: 1 }),
    actionId: IdSchema,
    nodeId: IdSchema,
    issuedAt: IsoTimeSchema,
    expiresAt: IsoTimeSchema,
    /** The limits the cloud checked against; a node holding newer limits checks against its own. */
    limitsVersion: Type.Integer({ minimum: 0 }),
    action: DeviceActionParamsSchema,
  },
  STRICT,
);
export type NodeActionEnvelope = Static<typeof NodeActionEnvelopeSchema>;

/** What a node answers for one action; a repeated actionId gets the report it got the first time. */
export const NodeActionReportSchema = Type.Object(
  {
    actionId: IdSchema,
    status: Type.Union([Type.Literal('executed'), Type.Literal('failed'), Type.Literal('refused')]),
    executedAt: IsoTimeSchema,
    result: Type.Optional(Type.Unknown()),
    refusal: Type.Optional(
      Type.Object({ layer: NodeRefusalLayerSchema, reason: Type.String({ minLength: 1 }) }, STRICT),
    ),
    error: Type.Optional(Type.String()),
  },
  STRICT,
);
export type NodeActionReport = Static<typeof NodeActionReportSchema>;

export const NODE_WORK_STATES = ['idle', 'busy', 'stuck'] as const;
export const NodeWorkSchema = Type.Object({
  state: Type.Enum(NODE_WORK_STATES),
  actionId: OrNull(IdSchema),
  kind: OrNull(DeviceActionKindSchema),
  step: OrNull(Type.String()),
  since: OrNull(IsoTimeSchema),
  reportedAt: OrNull(IsoTimeSchema),
}, STRICT);
export type NodeWork = Static<typeof NodeWorkSchema>;

export const NodeViewSchema = Type.Object({
  id: IdSchema,
  name: NodeNameSchema,
  platform: NodePlatformSchema,
  appVersion: Type.String(),
  protocolVersion: Type.Integer({ minimum: 1 }),
  capabilities: NodeCapabilitiesSchema,
  pairedAt: IsoTimeSchema,
  lastSeenAt: IsoTimeSchema,
  revokedAt: OrNull(IsoTimeSchema),
  /** The limits in force (the defaults until you set them on a device). */
  limits: DeviceLimitsSchema,
  limitsVersion: Type.Integer({ minimum: 0 }),
  limitsAreDefault: Type.Boolean(),
  limitsConfirmedAt: OrNull(IsoTimeSchema),
  /** Actions of each class sent in the last hour (the per-hour limit counts these). */
  usage: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
  online: Type.Boolean(),
  work: NodeWorkSchema,
  version: Type.Integer({ minimum: 1 }),
});
export type NodeView = Static<typeof NodeViewSchema>;

/** GET /v2/nodes */
export const NodeListResponseSchema = Type.Object({
  nodes: Type.Array(NodeViewSchema),
  defaults: DeviceLimitsSchema,
  protectedPaths: Type.Array(Type.String()),
});
export type NodeListResponse = Static<typeof NodeListResponseSchema>;

/** POST /v2/nodes/pairing-codes (signed) → 201. The code is in this answer only and never stored. */
export const IssueNodePairingCodeRequestSchema = Type.Object({ requestId: RequestIdSchema }, STRICT);
export type IssueNodePairingCodeRequest = Static<typeof IssueNodePairingCodeRequestSchema>;
export const NodePairingCodeResponseSchema = Type.Object({ code: Type.String(), expiresAt: IsoTimeSchema });
export type NodePairingCodeResponse = Static<typeof NodePairingCodeResponseSchema>;

/**
 * POST /v2/nodes/:id/limits (signed) → 200 NodeResponse. `limitsVersion` is the one the page showed; another current
 * version is 409 with the node as it is now.
 */
export const SetNodeLimitsRequestSchema = Type.Object(
  { requestId: RequestIdSchema, limitsVersion: Type.Integer({ minimum: 0 }), limits: DeviceLimitsSchema },
  STRICT,
);
export type SetNodeLimitsRequest = Static<typeof SetNodeLimitsRequestSchema>;

/** POST /v2/nodes/:id/revoke → 200 NodeResponse; revoking twice answers the same. */
export const RevokeNodeRequestSchema = Type.Object({ requestId: RequestIdSchema }, STRICT);
export type RevokeNodeRequest = Static<typeof RevokeNodeRequestSchema>;

export const NodeResponseSchema = Type.Object({ node: NodeViewSchema });
export type NodeResponse = Static<typeof NodeResponseSchema>;

export const NodeActionViewSchema = Type.Object({
  id: IdSchema,
  actionId: IdSchema,
  nodeId: IdSchema,
  kind: DeviceActionKindSchema,
  kindLabel: Type.String(),
  actionClass: DeviceActionClassSchema,
  target: Type.String(),
  status: NodeActionStatusSchema,
  refusalLayer: OrNull(NodeRefusalLayerSchema),
  reason: OrNull(Type.String()),
  origin: Type.Enum(NODE_ACTION_ORIGINS),
  requestedAt: IsoTimeSchema,
  executedAt: OrNull(IsoTimeSchema),
  /** Grows with every change of the row (sent → executed …): a newer event replaces an older one. */
  version: Type.Integer({ minimum: 1 }),
});
export type NodeActionView = Static<typeof NodeActionViewSchema>;

/** GET /v2/nodes/actions?nodeId= — newest first, 50. */
export const NODE_ACTIONS_PATH = `${NODES_PATH}/actions`;
export const NodeActionListQuerySchema = Type.Object({ nodeId: Type.Optional(IdSchema) }, STRICT);
export const NodeActionListResponseSchema = Type.Object({ actions: Type.Array(NodeActionViewSchema) });
export type NodeActionListResponse = Static<typeof NodeActionListResponseSchema>;
