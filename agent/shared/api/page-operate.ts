// 「问这一页 → 感知并操作整页」（2026-11-04 第 3 批，他定：看、点、翻页、填表直接做，提交前问他；付款、发帖 / 发消息、
// 删除、改设置一律先问；他看得到 Plasticine 在点哪）。注入网页标签的脚本是 client/src/mac/page-operate.ts（Mac、iPhone
// 的 Swift 原样各带一份），这里是两端共用的形状：
// - 感知（PagePerception）：页面结构的大纲（标题、正文、带编号的可点 / 可填元素）、元素清单、这次编号的 version。
//   「问这一页」开着时网页侧经 webTabs.tool(tabId, { kind: 'perceive' }) 读它带进引用片；任务里用设备动作 tab_perceive。
// - 操作（PageAct）：按编号点、填、选、回车，或翻页；设备动作 tab_act 带上感知时的 version，页面变了就要重新感知。
// - 提交（SubmitKind）：脚本按页面上真实的元素判「这一下是不是提交」，没放行就不做、回 submit_needs_you；放行只在云端
//   核对过他在要你定卡上选了提交之后（agent/src/devices/page-submits.ts）。
// - 步骤（PageOperateEvent）：Mac 每做一步经 __plasticineWebTabEvent 报给网页界面，对话框里列出来（状态符 + 一句）。

import { Type, type Static } from 'typebox';

const STRICT = { additionalProperties: false };

/** 大纲最多带这么多字（和 client/src/mac/page-operate.ts 的 MAX_OUTLINE 一致，测试核对）。 */
export const PAGE_OUTLINE_MAX_CHARS = 12_000;
/** 一次最多编这么多个元素（和脚本的 MAX_ELEMENTS 一致）。 */
export const PAGE_ELEMENTS_MAX = 200;
/** 对话框里一步的那一句：一行写得下。 */
export const PAGE_STEP_MAX_CHARS = 60;
/** 一次翻页最多滚这么多像素（和 browser.ts 的滚动上限同档）。 */
export const PAGE_SCROLL_MAX = 10_000;
/** 要填的字（和 tab_fill 同档）。 */
export const PAGE_FILL_MAX_CHARS = 4_000;

/** 提交的种类：付款、发出去（发帖 / 发消息 / 回复）、删除、改设置、一般的表单提交。 */
export const SUBMIT_KINDS = ['pay', 'publish', 'delete', 'settings', 'submit'] as const;
export const SubmitKindSchema = Type.Enum(SUBMIT_KINDS);
export type SubmitKind = Static<typeof SubmitKindSchema>;

/** 要你定卡上说「提交会发生什么」时用的词。 */
export const SUBMIT_KIND_LABELS: Readonly<Record<SubmitKind, string>> = {
  pay: '付款',
  publish: '以你的名义发出去',
  delete: '删除',
  settings: '改设置',
  submit: '提交表单',
};

export const PageElementSchema = Type.Object({
  n: Type.Integer({ minimum: 1, maximum: PAGE_ELEMENTS_MAX }),
  role: Type.String({ maxLength: 40 }),
  name: Type.String({ maxLength: 200 }),
  /** 输入框、下拉框里现在的值；密码框是 null（值从不回传）。 */
  value: Type.Optional(Type.Union([Type.String({ maxLength: 400 }), Type.Null()])),
  password: Type.Optional(Type.Boolean()),
  checked: Type.Optional(Type.Boolean()),
  disabled: Type.Optional(Type.Boolean()),
  href: Type.Optional(Type.String({ maxLength: 400 })),
  options: Type.Optional(Type.Array(Type.String({ maxLength: 80 }), { maxItems: 30 })),
  /** 点它（或在它里面回车）算提交：提交前问他。 */
  submit: Type.Optional(SubmitKindSchema),
}, STRICT);
export type PageElement = Static<typeof PageElementSchema>;

// Mac 框架读取最多登记60个文档；兼容0.7.5已持久化的局部子框架计数回执。
const PAGE_FRAME_COUNT_MAX = 60;

export const PagePerceptionSchema = Type.Object({
  version: Type.String({ minLength: 1, maxLength: 40 }),
  url: Type.String({ maxLength: 4_096 }),
  title: Type.String({ maxLength: 1_000 }),
  /** 页面结构：标题（#）、正文、[编号 角色「名字」…] 交错，按页面顺序。 */
  outline: Type.String({ maxLength: PAGE_OUTLINE_MAX_CHARS * 2 }),
  totalChars: Type.Integer({ minimum: 0 }),
  frameCount: Type.Optional(Type.Integer({ minimum: 0, maximum: PAGE_FRAME_COUNT_MAX })),
  truncated: Type.Boolean(),
  elements: Type.Array(PageElementSchema, { maxItems: PAGE_ELEMENTS_MAX }),
  /** 以图为主（字很少、有图片或画布）：要看懂这一页得截图。 */
  imageHeavy: Type.Boolean(),
  /** 大纲的摘要：点之前、点之后比一比页面变没变。 */
  digest: Type.String({ maxLength: 40 }),
}, STRICT);
export type PagePerception = Static<typeof PagePerceptionSchema>;

const ElementNumber = Type.Integer({ minimum: 1, maximum: PAGE_ELEMENTS_MAX });

/** 按编号做的一下。翻页不要编号。 */
export const PageActSchema = Type.Union([
  Type.Object({ op: Type.Literal('click'), n: ElementNumber }, STRICT),
  Type.Object({ op: Type.Literal('fill'), n: ElementNumber,
    value: Type.String({ maxLength: PAGE_FILL_MAX_CHARS }) }, STRICT),
  Type.Object({ op: Type.Literal('select'), n: ElementNumber,
    value: Type.String({ minLength: 1, maxLength: 200 }) }, STRICT),
  Type.Object({ op: Type.Literal('enter'), n: ElementNumber }, STRICT),
  Type.Object({ op: Type.Literal('scroll'),
    dy: Type.Integer({ minimum: -PAGE_SCROLL_MAX, maximum: PAGE_SCROLL_MAX }) }, STRICT),
]);
export type PageAct = Static<typeof PageActSchema>;

const PageState = Type.Object({ url: Type.String(), title: Type.String(), digest: Type.String() }, STRICT);

/** tab_act 的回执：点了谁、前后页面状态、填的读回一致没有、点的是不是提交（放行过的）、做完之后的页面。 */
export const PageActResultSchema = Type.Object({
  tabId: Type.String({ minLength: 1 }),
  op: Type.Union([Type.Literal('click'), Type.Literal('fill'), Type.Literal('select'), Type.Literal('enter'),
    Type.Literal('scroll')]),
  target: Type.Union([Type.Object({ n: ElementNumber, role: Type.String(), name: Type.String() }, STRICT),
    Type.Null()]),
  before: PageState,
  after: PageState,
  changed: Type.Boolean(),
  /** 填、选：读回的值和要填的一致；点、翻页是 null。 */
  matches: Type.Union([Type.Boolean(), Type.Null()]),
  submitted: Type.Union([SubmitKindSchema, Type.Null()]),
  page: PagePerceptionSchema,
}, STRICT);
export type PageActResult = Static<typeof PageActResultSchema>;

/** 没放行的提交：设备没点，回执的 result 里带这个（errorCode 是 submit_needs_you）。 */
export const PageSubmitHoldSchema = Type.Object({
  submit: Type.Object({ kind: SubmitKindSchema, label: Type.String() }, STRICT),
  target: Type.Object({ n: ElementNumber, role: Type.String(), name: Type.String() }, STRICT),
}, { additionalProperties: true });
export type PageSubmitHold = Static<typeof PageSubmitHoldSchema>;

export const PAGE_STEP_STATUSES = ['run', 'done', 'wait', 'err'] as const;
export type PageStepStatus = (typeof PAGE_STEP_STATUSES)[number];

/** Mac 报给网页界面的一步（WebTabEvent 的 operate）：同一个 actionId 先 run，再 done / wait / err。 */
export const PageOperateEventSchema = Type.Object({
  type: Type.Literal('operate'),
  tabId: Type.String({ minLength: 1, maxLength: 100 }),
  actionId: Type.String({ minLength: 1, maxLength: 200 }),
  status: Type.Enum(PAGE_STEP_STATUSES),
  step: Type.String({ minLength: 1, maxLength: PAGE_STEP_MAX_CHARS * 2 }),
}, STRICT);
export type PageOperateEvent = Static<typeof PageOperateEventSchema>;
