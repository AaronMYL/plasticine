// /v2/devices: the devices that paired (decision 90 ②). Listing shows revoked ones too; revoking ends every
// session of that device at once.
//
// M5 — 执行节点（设备服务）的协议和 /v2/nodes。节点客户端（Mac 设备服务、浏览器节点）照下面写：
//   1. 用户在已配对页面领一个一次性配对码（POST /v2/nodes/pairing-codes，10 分钟、用一次）。
//   2. 节点 POST /v2/nodes/pair 带码、名字、平台、版本、协议版本和能力清单 → 回 nodeId 和长期凭证 credential。凭证只出现
//      在这一次回答里，服务端只存散列；回答丢了用同一个 requestId 和同一个码重发，服务端给同一台节点换一个新凭证（旧的
//      从没送到过，随即作废），不新建节点。
//   3. 之后每个请求带 `authorization: Bearer <credential>`。POST /v2/nodes/hello 报能力清单，拿回设备侧上限（limits 和
//      limitsVersion）；节点自己也按这份上限拒（第 8 节第 2 层：云端放不宽，设备直接拒绝并报告）。
//   4. 动作是 NodeActionEnvelope：参数给齐（设备不补判断），带 actionId。同一个 actionId 再到达，节点返回已有状态、不重做；
//      节点回 NodeActionReport。超上限、受保护路径、缺参数一律 refused，带哪一层和一句原因，不排队。
//   5. 节点被撤销后凭证立刻失效（401），之后的动作云端直接拒。
// Mac 的线上动作通道见 node-channel.ts；内部传输仍使用这里的 envelope/report，测试可注入假节点。

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
import { IOS_ACTION_PARAM_SCHEMAS, IOS_KIND_CLASSES, IOS_KIND_LABELS } from './device-ios.ts';
import { OrNull } from './lineage.ts';
import { PAGE_STEP_MAX_CHARS, PageActSchema } from './page-operate.ts';

export const DEVICES_PATH = `${API_PREFIX}/devices`;

export const DeviceViewSchema = Type.Object({
  id: IdSchema,
  name: DeviceNameSchema,
  firstSeenAt: IsoTimeSchema,
  lastSeenAt: IsoTimeSchema,
  revokedAt: Type.Union([IsoTimeSchema, Type.Null()]),
  /** The device this request came from. */
  current: Type.Boolean(),
  /**
   * 桌面客户端替本机界面登录的那台（POST /v2/session/local）：设备列表里显示「这台电脑」。旧客户端缓存里没有这一项，
   * 没有按 false。
   */
  local: Type.Optional(Type.Boolean()),
});
export type DeviceView = Static<typeof DeviceViewSchema>;

/** GET /v2/devices */
export const DeviceListResponseSchema = Type.Object({ devices: Type.Array(DeviceViewSchema) });
export type DeviceListResponse = Static<typeof DeviceListResponseSchema>;

/** DELETE /v2/devices/:id — revoking the current device logs this browser out as well. */
export const RevokeDeviceResponseSchema = Type.Object({ device: DeviceViewSchema });
export type RevokeDeviceResponse = Static<typeof RevokeDeviceResponseSchema>;

// ---------- M5：执行节点 ----------

export const NODES_PATH = `${API_PREFIX}/nodes`;
export const NODE_PAIR_PATH = `${NODES_PATH}/pair`;
export const NODE_HELLO_PATH = `${NODES_PATH}/hello`;
export const NODE_PAIRING_CODES_PATH = `${NODES_PATH}/pairing-codes`;
export const NODE_PROTOCOL_VERSION = 1;
/** The node's credential goes in `authorization: Bearer …`, never in a URL or a body. */
export const NODE_CREDENTIAL_SCHEME = 'Bearer';

export const DEVICE_CLASS_LABELS: Readonly<Record<DeviceActionClass, string>> = {
  read: '读',
  write: '写',
  delete: '删',
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

/** Which class each kind counts against (第 8 节第 2 层)；截图、点击、打开应用都是「点击输入」这一类。 */
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
  // 网页标签：读、开、换地址算「浏览器站点」；点和填按 DOM 做、不动真鼠标，但改的是用户登录着的页面，算「点击输入」。
  tab_list: 'browser',
  tab_read: 'browser',
  tab_open: 'browser',
  tab_navigate: 'browser',
  tab_click: 'input',
  tab_fill: 'input',
  tab_perceive: 'browser',
  tab_act: 'input',
  ...IOS_KIND_CLASSES,
};

const STRICT = { additionalProperties: false };
// A path on the device: absolute or under ~ (设备不补判断：相对路径不收).
export const DevicePathSchema = Type.String({ minLength: 1, maxLength: 1_000 });
// The old notebook limit for one note (400 000 characters): a write back carries at most one document.
export const DEVICE_WRITE_MAX_CHARS = 400_000;
export const DEVICE_COMMAND_MAX_CHARS = 4_000;
const UrlSchema = Type.String({ pattern: '^https?://', maxLength: 2_048 });
// 网页标签的标识由 Mac 给（tab_list / tab_open 的回执里有），网页界面里开的标签也是同一个标识。
export const WebTabIdSchema = Type.String({ minLength: 1, maxLength: 100 });
// CSS 选择器或按钮上的字：给人读的长度就够了。
export const TAB_SELECTOR_MAX_CHARS = 500;
export const TAB_CLICK_TEXT_MAX_CHARS = 200;
export const TAB_FILL_MAX_CHARS = 4_000;
const SelectorSchema = Type.String({ minLength: 1, maxLength: TAB_SELECTOR_MAX_CHARS });

/** One action with every parameter given (《应用架构方案》第 4 节：设备不补判断). */
export const DeviceActionParamsSchema = Type.Union([
  Type.Object({ kind: Type.Literal('file_list'), path: DevicePathSchema }, STRICT),
  Type.Object({ kind: Type.Literal('file_read'), path: DevicePathSchema }, STRICT),
  Type.Object(
    {
      kind: Type.Literal('file_write'),
      path: DevicePathSchema,
      content: Type.String({ maxLength: DEVICE_WRITE_MAX_CHARS }),
      /** The version read before (写回前核对读取时的版本); null only for a new file. */
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
  /** offset：从正文第几个字读起（第一次 0；回执的 nextOffset 接着读）。链接和表单字段只在 offset 为 0 时带。 */
  Type.Object({ kind: Type.Literal('tab_read'), tabId: WebTabIdSchema, offset: Type.Integer({ minimum: 0 }) }, STRICT),
  Type.Object({ kind: Type.Literal('tab_open'), url: UrlSchema }, STRICT),
  Type.Object({ kind: Type.Literal('tab_navigate'), tabId: WebTabIdSchema, url: UrlSchema }, STRICT),
  /** 按 CSS 选择器或按看得见的字点：两项恰好给一项，另一项是 null。 */
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
  /** 感知整页：页面结构、带编号的可点 / 可填元素（page-operate.ts 的 PagePerception）。 */
  Type.Object({ kind: Type.Literal('tab_perceive'), tabId: WebTabIdSchema }, STRICT),
  /**
   * 按编号做一下（第 3 批）：version 是感知时回的那个，页面变了就要重新感知。step 是对话框里这一步的那一句。
   * submitAsk：点的是提交时，他在要你定卡上选了提交的那张卡；云端核对过才发（devices/page-submits.ts），平时是 null。
   */
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

/** POST /v2/nodes/hello (Bearer credential) → 200 NodeHelloResponse. */
export const NodeHelloRequestSchema = Type.Object(
  {
    appVersion: NodeVersionSchema,
    protocolVersion: Type.Integer({ minimum: 1 }),
    capabilities: NodeCapabilitiesSchema,
    /**
     * 可选：用户最近一次键鼠活动距今多少秒。报了而且用户正在用，点击 / 输入就等着，不和用户抢；不报照现状执行。
     */
    idleSeconds: Type.Optional(Type.Integer({ minimum: 0, maximum: NODE_IDLE_SECONDS_MAX })),
  },
  STRICT,
);
export type NodeHelloRequest = Static<typeof NodeHelloRequestSchema>;

export const NodeHelloResponseSchema = Type.Object({
  nodeId: IdSchema,
  limits: DeviceLimitsSchema,
  limitsVersion: Type.Integer({ minimum: 0 }),
});
export type NodeHelloResponse = Static<typeof NodeHelloResponseSchema>;

/** What the cloud sends a node for one action. */
export const NodeActionEnvelopeSchema = Type.Object(
  {
    protocolVersion: Type.Integer({ minimum: 1 }),
    actionId: IdSchema,
    nodeId: IdSchema,
    issuedAt: IsoTimeSchema,
    /** After this the node does not start it any more (离线规则：派发时写明期限). */
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
  version: Type.Integer({ minimum: 1 }),
});
export type NodeView = Static<typeof NodeViewSchema>;

/** GET /v2/nodes */
export const NodeListResponseSchema = Type.Object({
  nodes: Type.Array(NodeViewSchema),
  defaults: DeviceLimitsSchema,
  /** 受保护路径：任何设备动作碰到都拒，上限放不宽它们。 */
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
  /** 一句原因（被拒、没做成时）。 */
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
export type NodeActionListQuery = Static<typeof NodeActionListQuerySchema>;
export const NodeActionListResponseSchema = Type.Object({ actions: Type.Array(NodeActionViewSchema) });
export type NodeActionListResponse = Static<typeof NodeActionListResponseSchema>;
