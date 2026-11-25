import { Type, type Static } from 'typebox';

const STRICT = { additionalProperties: false };

export const PAGE_OUTLINE_MAX_CHARS = 12_000;
export const PAGE_ELEMENTS_MAX = 200;
export const PAGE_STEP_MAX_CHARS = 60;
export const PAGE_SCROLL_MAX = 10_000;
export const PAGE_FILL_MAX_CHARS = 4_000;

export const SUBMIT_KINDS = ['pay', 'publish', 'delete', 'settings', 'submit'] as const;
export const SubmitKindSchema = Type.Enum(SUBMIT_KINDS);
export type SubmitKind = Static<typeof SubmitKindSchema>;

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
  value: Type.Optional(Type.Union([Type.String({ maxLength: 400 }), Type.Null()])),
  password: Type.Optional(Type.Boolean()),
  checked: Type.Optional(Type.Boolean()),
  disabled: Type.Optional(Type.Boolean()),
  href: Type.Optional(Type.String({ maxLength: 400 })),
  options: Type.Optional(Type.Array(Type.String({ maxLength: 80 }), { maxItems: 30 })),
  submit: Type.Optional(SubmitKindSchema),
}, STRICT);

const PAGE_FRAME_COUNT_MAX = 60;

export const PagePerceptionSchema = Type.Object({
  version: Type.String({ minLength: 1, maxLength: 40 }),
  url: Type.String({ maxLength: 4_096 }),
  title: Type.String({ maxLength: 1_000 }),
  outline: Type.String({ maxLength: PAGE_OUTLINE_MAX_CHARS * 2 }),
  totalChars: Type.Integer({ minimum: 0 }),
  frameCount: Type.Optional(Type.Integer({ minimum: 0, maximum: PAGE_FRAME_COUNT_MAX })),
  truncated: Type.Boolean(),
  elements: Type.Array(PageElementSchema, { maxItems: PAGE_ELEMENTS_MAX }),
  imageHeavy: Type.Boolean(),
  digest: Type.String({ maxLength: 40 }),
}, STRICT);
export type PagePerception = Static<typeof PagePerceptionSchema>;

const ElementNumber = Type.Integer({ minimum: 1, maximum: PAGE_ELEMENTS_MAX });

export const PageActSchema = Type.Union([
  Type.Object({ op: Type.Literal('click'), n: ElementNumber }, STRICT),
  Type.Object({ op: Type.Literal('fill'), n: ElementNumber,
    value: Type.String({ maxLength: PAGE_FILL_MAX_CHARS }) }, STRICT),
  Type.Object({ op: Type.Literal('select'), n: ElementNumber,
    value: Type.String({ minLength: 1, maxLength: 200 }) }, STRICT),
  Type.Object({ op: Type.Literal('enter'), n: ElementNumber }, STRICT),
  Type.Object({ op: Type.Literal('scroll'), n: Type.Optional(ElementNumber),
    dy: Type.Integer({ minimum: -PAGE_SCROLL_MAX, maximum: PAGE_SCROLL_MAX }) }, STRICT),
]);
export type PageAct = Static<typeof PageActSchema>;

const PageState = Type.Object({ url: Type.String(), title: Type.String(), digest: Type.String() }, STRICT);

export const PageActResultSchema = Type.Object({
  tabId: Type.String({ minLength: 1 }),
  op: Type.Union([Type.Literal('click'), Type.Literal('fill'), Type.Literal('select'), Type.Literal('enter'),
    Type.Literal('scroll')]),
  target: Type.Union([Type.Object({ n: ElementNumber, role: Type.String(), name: Type.String() }, STRICT),
    Type.Null()]),
  before: PageState,
  after: PageState,
  changed: Type.Boolean(),
  matches: Type.Union([Type.Boolean(), Type.Null()]),
  submitted: Type.Union([SubmitKindSchema, Type.Null()]),
  page: PagePerceptionSchema,
}, STRICT);

export const PageSubmitHoldSchema = Type.Object({
  submit: Type.Object({ kind: SubmitKindSchema, label: Type.String() }, STRICT),
  target: Type.Object({ n: ElementNumber, role: Type.String(), name: Type.String() }, STRICT),
}, { additionalProperties: true });
export type PageSubmitHold = Static<typeof PageSubmitHoldSchema>;

export const PAGE_STEP_STATUSES = ['run', 'done', 'wait', 'err'] as const;
export type PageStepStatus = (typeof PAGE_STEP_STATUSES)[number];

export const PageOperateEventSchema = Type.Object({
  type: Type.Literal('operate'),
  tabId: Type.String({ minLength: 1, maxLength: 100 }),
  actionId: Type.String({ minLength: 1, maxLength: 200 }),
  status: Type.Enum(PAGE_STEP_STATUSES),
  step: Type.String({ minLength: 1, maxLength: PAGE_STEP_MAX_CHARS * 2 }),
}, STRICT);
export type PageOperateEvent = Static<typeof PageOperateEventSchema>;
