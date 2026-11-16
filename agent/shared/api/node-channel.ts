// Mac 节点的 HTTPS 长轮询协议。内部 NodeActionEnvelope 不作为线上响应，字段按 Mac 协议固定。
import { Type, type Static } from 'typebox';
import { DeviceActionKindSchema, type DeviceActionKind } from '../state-devices.ts';
import { IdSchema, IsoTimeSchema } from './common.ts';
import { DESK_RESULT_SCHEMAS } from './device-desk.ts';
import { IOS_RESULT_SCHEMAS } from './device-ios.ts';
import { PageActResultSchema, PagePerceptionSchema } from './page-operate.ts';
import { NODE_ACTIONS_PATH } from './devices.ts';

const STRICT = { additionalProperties: false };
export const NODE_NEXT_ACTION_PATH = `${NODE_ACTIONS_PATH}/next`;
// Mac 每 25 秒重新长轮询；90 秒没有心跳才显示离线。11-16 起设备每 20 秒单独报到一次，做动作时也报。
export const NODE_POLL_MAX_SECONDS = 25;
export const NODE_ONLINE_MS = 90_000;
export const NODE_HELLO_EVERY_MS = 20_000;
// 包含屏幕 PNG 的 base64；仅节点结果接口使用这个请求上限。
export const NODE_RESULT_MAX_BYTES = 24 * 1024 * 1024;
export const NodeNextActionQuerySchema = Type.Object({
  wait: Type.Optional(Type.String({ pattern: '^(?:[0-9]|1[0-9]|2[0-5])$' })),
}, STRICT);

export const NodeWireActionSchema = Type.Object({
  id: IdSchema,
  kind: DeviceActionKindSchema,
  params: Type.Record(Type.String(), Type.Unknown()),
  deadline: IsoTimeSchema,
}, STRICT);
export type NodeWireAction = Static<typeof NodeWireActionSchema>;
export const NodeNextActionResponseSchema = Type.Object({ action: NodeWireActionSchema }, STRICT);

/**
 * 设备失败的种类（第 102 条「设备失败先分类」），failed 时可选上报：screenshot_stale 点击坐标所依据的截图已过期
 * （显示器变了、App 重启过），服务端自动重截一次再让模型重新定位。user_present 用户正看着这个网页标签
 * （Plasticine 窗口在前台、这个标签开着、30 秒内动过键鼠）：没有点也没有填，任务等用户停下来，不算失败。
 * submit_needs_you（第 3 批）：tab_act 要点的是提交（付款、发出去、删除、改设置、表单提交）而没有放行，设备没点，
 * result 里带 page-operate.ts 的 PageSubmitHold；脑先出要你定卡问他。page_stale：tab_act 的编号过期（页面变了），没做，
 * 先重新感知。这两种都不算设备没做成。
 * 不报照旧按一般失败处理。
 */
export const DEVICE_FAILURE_CODES = ['screenshot_stale', 'user_present', 'submit_needs_you', 'page_stale', 'timed_out',
  'cancelled'] as const;
export type DeviceFailureCode = (typeof DEVICE_FAILURE_CODES)[number];
/** retryable：只读的（截图、读页面、列文件）可以直接再做；点、填、发、写、跑命令要先核实做没做成。 */
export const DeviceTimeoutSchema = Type.Object({
  step: Type.String({ maxLength: 200 }),
  afterMs: Type.Integer({ minimum: 0 }),
  retryable: Type.Boolean(),
}, STRICT);
export type DeviceTimeout = Static<typeof DeviceTimeoutSchema>;

export const NodeActionResultRequestSchema = Type.Object({
  status: Type.Union([Type.Literal('executed'), Type.Literal('failed'), Type.Literal('refused')]),
  result: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  error: Type.Optional(Type.String()),
  errorCode: Type.Optional(Type.Enum(DEVICE_FAILURE_CODES)),
  refusalLayer: Type.Optional(Type.Literal('device')),
  /** 11-16：做了超过时限还没做完（errorCode timed_out）：卡在哪一步、等了多久、能不能直接再做一遍。 */
  timedOut: Type.Optional(DeviceTimeoutSchema),
}, STRICT);
export type NodeActionResultRequest = Static<typeof NodeActionResultRequestSchema>;

const Version = Type.String({ pattern: '^[a-f0-9]{64}$' });
const Empty = Type.Object({}, STRICT);
/**
 * 第 102 条「点击后再截一张」：点击 / 输入做完后设备再截一张，回执带它的摘要；画面有没有变化由设备比对（changed）。
 * 截图原图不进回执（要看再发 screen_capture）。旧 App 不报这两项：回执照收，但不算证明了点到。
 */
export const DeviceAfterShotSchema = Type.Object({ sha256: Version, width: Type.Integer({ minimum: 1 }),
  height: Type.Integer({ minimum: 1 }), capturedAt: IsoTimeSchema, beforeSha256: Type.Optional(Version) }, STRICT);
const InputResult = Type.Object({ afterShot: Type.Optional(DeviceAfterShotSchema),
  changed: Type.Optional(Type.Boolean()) }, STRICT);

export const TAB_READ_LINKS_MAX = 40;
export const TAB_READ_FIELDS_MAX = 30;
const Text = Type.String();
const TabIdText = Type.String({ minLength: 1 });
export const WebTabSummarySchema = Type.Object({ tabId: TabIdText, url: Text, title: Text, active: Type.Boolean(),
  loading: Type.Boolean() }, STRICT);
/** 一个表单字段：密码框的值从不回传（value 是 null），只说它是密码框。 */
export const WebTabFieldSchema = Type.Object({ selector: Text, tag: Text, type: Text, name: Text, label: Text,
  value: Type.Union([Text, Type.Null()]), checked: Type.Union([Type.Boolean(), Type.Null()]),
  disabled: Type.Boolean() }, STRICT);
/** 点击前后读回的页面状态：digest 是地址、标题、正文和被点元素状态合起来的 SHA-256（设备算）。 */
export const WebTabDomStateSchema = Type.Object({ url: Text, title: Text, digest: Version }, STRICT);
const TabPage = { tabId: TabIdText, url: Text, title: Text, loaded: Type.Boolean() };
export const DEVICE_RESULT_SCHEMAS = {
  file_list: Type.Object({ entries: Type.Array(Type.Object({
    name: Type.String(), type: Type.Union([Type.Literal('file'), Type.Literal('dir'), Type.Literal('link')]),
    size: Type.Number({ minimum: 0 }), modifiedAt: IsoTimeSchema,
  }, STRICT)) }, STRICT),
  file_read: Type.Object({ content: Type.String(),
    encoding: Type.Union([Type.Literal('utf8'), Type.Literal('base64')]), version: Version }, STRICT),
  file_write: Type.Object({ version: Version }, STRICT),
  file_delete: Empty,
  run_command: Type.Object({ exitCode: Type.Integer(), stdout: Type.String(), stderr: Type.String(),
    truncated: Type.Boolean() }, STRICT),
  browser_open: Empty,
  browser_read: Type.Object({ text: Type.String(), truncated: Type.Boolean() }, STRICT),
  screen_capture: Type.Object({ png: Type.String(), width: Type.Integer({ minimum: 1 }),
    height: Type.Integer({ minimum: 1 }) }, STRICT),
  input_click: InputResult,
  input_type: InputResult,
  app_open: Empty,
  /** viewing：用户此刻正看着的网页标签（Plasticine 窗口在前台、中间区是它），没有就是 null。 */
  tab_list: Type.Object({ tabs: Type.Array(WebTabSummarySchema),
    viewing: Type.Union([TabIdText, Type.Null()]) }, STRICT),
  tab_read: Type.Object({ tabId: TabIdText, url: Text, title: Text, text: Text,
    offset: Type.Integer({ minimum: 0 }), totalChars: Type.Integer({ minimum: 0 }),
    nextOffset: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    links: Type.Array(Type.Object({ text: Text, href: Text }, STRICT), { maxItems: TAB_READ_LINKS_MAX }),
    fields: Type.Array(WebTabFieldSchema, { maxItems: TAB_READ_FIELDS_MAX }),
    linksTruncated: Type.Boolean(), fieldsTruncated: Type.Boolean() }, STRICT),
  tab_open: Type.Object(TabPage, STRICT),
  tab_navigate: Type.Object(TabPage, STRICT),
  tab_click: Type.Object({ tabId: TabIdText, target: Type.Object({ tag: Text, text: Text }, STRICT),
    before: WebTabDomStateSchema, after: WebTabDomStateSchema, changed: Type.Boolean() }, STRICT),
  /** matches：填完后读回输入框的值和要填的一致（密码框也在设备上比，值不回传）。 */
  tab_fill: Type.Object({ tabId: TabIdText, selector: Text, tag: Text, type: Text, matches: Type.Boolean() }, STRICT),
  tab_perceive: Type.Object({ tabId: TabIdText, ...PagePerceptionSchema.properties }, STRICT),
  tab_act: PageActResultSchema,
  /** jpeg 是 base64；width / height 是视口的 CSS 像素（tab_point 的坐标照它）。 */
  tab_shot: Type.Object({ tabId: TabIdText, url: Text, jpeg: Type.String(), width: Type.Integer({ minimum: 1 }),
    height: Type.Integer({ minimum: 1 }) }, STRICT),
  /** target 是点到的那个元素（标签名和字）；changed：点之后页面变了。 */
  tab_point: Type.Object({ tabId: TabIdText, target: Type.Object({ tag: Text, text: Text }, STRICT),
    before: WebTabDomStateSchema, after: WebTabDomStateSchema, changed: Type.Boolean() }, STRICT),
  tab_close: Type.Object({ tabId: TabIdText }, STRICT),
  /** met：等到了（出现或消失）；waitedMs：等了多久。 */
  tab_wait: Type.Object({ tabId: TabIdText, met: Type.Boolean(), waitedMs: Type.Integer({ minimum: 0 }) }, STRICT),
  /** matches：打完读回焦点里的字包含要打的。 */
  tab_type: Type.Object({ tabId: TabIdText, tag: Text, matches: Type.Boolean() }, STRICT),
  /** changed：按完页面变了（弹窗关了、焦点挪了也算）。 */
  tab_key: Type.Object({ tabId: TabIdText, key: Text, before: WebTabDomStateSchema, after: WebTabDomStateSchema,
    changed: Type.Boolean() }, STRICT),
  /** moved：那一块真的滚动了（到底了就是 false）。 */
  tab_scroll: Type.Object({ tabId: TabIdText, moved: Type.Boolean() }, STRICT),
  /** handled：编辑器自己接住了粘贴（排版照它的来）；matches：读回焦点里的字包含粘的开头。 */
  tab_paste: Type.Object({ tabId: TabIdText, tag: Text, handled: Type.Boolean(), matches: Type.Boolean() }, STRICT),
  tab_show: Type.Object({ tabId: TabIdText }, STRICT),
  /** files：上传框读回的文件名；via：直接放进文件框（input）还是接住了「选择文件」（chooser）。 */
  tab_upload: Type.Object({ tabId: TabIdText, files: Type.Array(Text), via: Type.Union([Type.Literal('input'),
    Type.Literal('chooser')]) }, STRICT),
  file_fetch: Type.Object({ path: Text, name: Text, bytes: Type.Integer({ minimum: 0 }), base64: Type.String() },
    STRICT),
  file_put: Type.Object({ path: Text, bytes: Type.Integer({ minimum: 0 }) }, STRICT),
  ...DESK_RESULT_SCHEMAS,
  ...IOS_RESULT_SCHEMAS,
} satisfies Record<DeviceActionKind, object>;

/**
 * 设备动作的完成证明（第 102 条：设备回执才算数，「我点了」不算），由服务端按回执判定后放进工具结果：
 * 写文件回读版本与写入内容一致、点击 / 输入后有一张新截图且画面变了；其余动作的回执本身就是结果。
 */
export const DeviceProofSchema = Type.Object({ proven: Type.Boolean(), rule: Type.String(),
  detail: Type.String() }, STRICT);
export type DeviceProof = Static<typeof DeviceProofSchema>;
