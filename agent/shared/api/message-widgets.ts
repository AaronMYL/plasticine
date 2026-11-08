// 消息里的互动部件（设计稿 2026-11-03，用户要求「对话记录要像聊天一样直观」）：你和 Plasticine 的一条消息除了文字，
// 还可以带图片、选项、输入框、表格、确认按钮和工具卡（记账 / 专注 / 提醒 / 日历），在对话里直接点完，不用每次去展开。
// 只加不改：MessageView 多一个可选的 widgets 字段，旧消息没有它照常显示。
// 上线（2026-11-03 shell3）：Plasticine 在回复里用 show_widgets 工具放部件（参数是下面的 WidgetDraftSchema，
// 服务端补齐 id 和对照数，挂在这一步的结果上）；用户作答走 POST /v2/lines/:id/widgets（shared/api/lines.ts）：
// 部件的答案和状态写回那一步，选项 / 输入框 / 确认的答案作为一句话发进线让 Plasticine 往下说；记账卡点确认才真正
// 记上，撤销把它拿掉。
// 部件不碰用户确认字段（p、现实结果、约定生效），那些由有效的本人配对会话确认。
// 金额用整数分，时间用 ISO 字符串（plasticine-code「数据与状态」）。

import { Type, type Static } from 'typebox';
import { FOCUS_MINUTES_MAX, FOCUS_MINUTES_MIN } from '../state-life.ts';
import { IdSchema, IsoTimeSchema } from './common.ts';

/** 一条消息最多带这么多个部件：再多该是一页，不是一条消息。 */
export const MESSAGE_WIDGETS_MAX = 8;
/** 选项部件最多几个选项（要你定卡是 2–5 个，这里给到 8 个以容纳多选）。 */
export const WIDGET_CHOICE_OPTIONS_MAX = 8;
/** 表格部件最多几行几列：放不下的给「打开」开成标签看全貌。 */
export const WIDGET_TABLE_ROWS_MAX = 50;
export const WIDGET_TABLE_COLUMNS_MAX = 8;
/** 日历卡画那天已有的几段：再多时间条看不清。 */
export const CALENDAR_AROUND_MAX = 12;

const STRICT = { additionalProperties: false };
const Text = (max: number) => Type.String({ maxLength: max });

export const ImageWidgetSchema = Type.Object({
  kind: Type.Literal('image'),
  id: IdSchema,
  /** 附件的内容地址（/v2/attachments/:id/content）或 data: / https: 图片地址。 */
  src: Type.String({ minLength: 1, maxLength: 200_000 }),
  alt: Text(200),
  width: Type.Optional(Type.Integer({ minimum: 1 })),
  height: Type.Optional(Type.Integer({ minimum: 1 })),
  caption: Type.Optional(Text(200)),
}, STRICT);

export const ChoiceWidgetSchema = Type.Object({
  kind: Type.Literal('choice'),
  id: IdSchema,
  prompt: Text(200),
  options: Type.Array(Type.Object({
    id: IdSchema,
    label: Text(40),
    hint: Type.Optional(Text(80)),
    recommended: Type.Optional(Type.Boolean()),
  }, STRICT), { minItems: 2, maxItems: WIDGET_CHOICE_OPTIONS_MAX }),
  multiple: Type.Boolean(),
  /** 已经选了哪些；没答是 null。 */
  answer: Type.Union([Type.Array(IdSchema), Type.Null()]),
}, STRICT);

export const InputWidgetSchema = Type.Object({
  kind: Type.Literal('input'),
  id: IdSchema,
  label: Text(80),
  placeholder: Text(80),
  submitLabel: Text(12),
  multiline: Type.Boolean(),
  answer: Type.Union([Text(2_000), Type.Null()]),
}, STRICT);

export const TableWidgetSchema = Type.Object({
  kind: Type.Literal('table'),
  id: IdSchema,
  caption: Type.Optional(Text(80)),
  columns: Type.Array(Type.Object({
    key: Type.String({ minLength: 1, maxLength: 40 }),
    label: Text(20),
    align: Type.Optional(Type.Union([Type.Literal('start'), Type.Literal('end')])),
  }, STRICT), { minItems: 1, maxItems: WIDGET_TABLE_COLUMNS_MAX }),
  rows: Type.Array(Type.Record(Type.String(), Text(200)), { maxItems: WIDGET_TABLE_ROWS_MAX }),
}, STRICT);

export const CONFIRM_STATES = ['open', 'confirmed', 'cancelled'] as const;

export const ConfirmWidgetSchema = Type.Object({
  kind: Type.Literal('confirm'),
  id: IdSchema,
  text: Text(200),
  confirmLabel: Text(12),
  cancelLabel: Text(12),
  state: Type.Union([Type.Literal('open'), Type.Literal('confirmed'), Type.Literal('cancelled')]),
}, STRICT);

/** 工具卡的三种状态：草稿等你点确认、已经做了、取消了。 */
export const TOOL_CARD_STATES = ['draft', 'done', 'cancelled'] as const;
const ToolCardState = Type.Union([Type.Literal('draft'), Type.Literal('done'), Type.Literal('cancelled')]);
/** 点了确认之后写下的那一条（记账的一笔、提醒、专注的一段）；撤销按它拿掉。草稿和取消时没有。 */
const RecordRef = Type.Optional(Type.Union([IdSchema, Type.Null()]));

export const MoneyCardSchema = Type.Object({
  kind: Type.Literal('tool'),
  id: IdSchema,
  tool: Type.Literal('money'),
  state: ToolCardState,
  amountCents: Type.Integer(),
  currency: Type.String({ minLength: 3, maxLength: 3 }),
  category: Text(20),
  note: Text(80),
  occurredAt: IsoTimeSchema,
  /** 本月这一类已经花了多少（记上之后的数），给一行对照；不知道是 null。 */
  monthCategoryCents: Type.Union([Type.Integer(), Type.Null()]),
  recordId: RecordRef,
}, STRICT);

export const FocusCardSchema = Type.Object({
  kind: Type.Literal('tool'),
  id: IdSchema,
  tool: Type.Literal('focus'),
  state: ToolCardState,
  minutes: Type.Integer({ minimum: 1, maximum: 600 }),
  label: Text(40),
  /** 开始了就有，草稿时为 null。 */
  startedAt: Type.Union([IsoTimeSchema, Type.Null()]),
  todayMinutes: Type.Integer({ minimum: 0 }),
  recordId: RecordRef,
}, STRICT);

export const ReminderCardSchema = Type.Object({
  kind: Type.Literal('tool'),
  id: IdSchema,
  tool: Type.Literal('reminder'),
  state: ToolCardState,
  text: Text(120),
  dueAt: IsoTimeSchema,
  repeat: Type.Union([Text(20), Type.Null()]),
  /** 到点怎么告诉你（邮件、这台 Mac 的通知……）。 */
  channel: Text(20),
  recordId: RecordRef,
}, STRICT);

export const CalendarCardSchema = Type.Object({
  kind: Type.Literal('tool'),
  id: IdSchema,
  tool: Type.Literal('calendar'),
  state: ToolCardState,
  title: Text(80),
  startAt: IsoTimeSchema,
  endAt: IsoTimeSchema,
  location: Type.Union([Text(80), Type.Null()]),
  /** 那天已有的安排（画时间条用）；撞上的标 conflict。 */
  around: Type.Array(Type.Object({
    title: Text(80),
    startAt: IsoTimeSchema,
    endAt: IsoTimeSchema,
    conflict: Type.Boolean(),
  }, STRICT), { maxItems: CALENDAR_AROUND_MAX }),
  recordId: RecordRef,
}, STRICT);

export const ToolCardSchema = Type.Union([MoneyCardSchema, FocusCardSchema, ReminderCardSchema, CalendarCardSchema]);

export const MessageWidgetSchema = Type.Union([
  ImageWidgetSchema,
  ChoiceWidgetSchema,
  InputWidgetSchema,
  TableWidgetSchema,
  ConfirmWidgetSchema,
  ToolCardSchema,
]);

export type ImageWidget = Static<typeof ImageWidgetSchema>;
export type ChoiceWidget = Static<typeof ChoiceWidgetSchema>;
export type InputWidget = Static<typeof InputWidgetSchema>;
export type TableWidget = Static<typeof TableWidgetSchema>;
export type ConfirmWidget = Static<typeof ConfirmWidgetSchema>;
export type MoneyCard = Static<typeof MoneyCardSchema>;
export type FocusCard = Static<typeof FocusCardSchema>;
export type ReminderCard = Static<typeof ReminderCardSchema>;
export type CalendarCard = Static<typeof CalendarCardSchema>;
export type ToolCard = Static<typeof ToolCardSchema>;
export type MessageWidget = Static<typeof MessageWidgetSchema>;

/**
 * 作答：选项是选中的 id（可以改，再答一次就换掉），输入框是一段字，确认和工具卡是 confirm / cancel；
 * undo 只给工具卡：做了的拿掉（记的那笔删掉、提醒删掉、专注停下），取消了的回到草稿，都回到等你点的样子。
 */
export const MessageWidgetAnswerSchema = Type.Union([
  Type.Object({ kind: Type.Literal('choice'), optionIds: Type.Array(IdSchema, { minItems: 1 }) }, STRICT),
  Type.Object({ kind: Type.Literal('input'), text: Type.String({ minLength: 1, maxLength: 2_000 }) }, STRICT),
  Type.Object({ kind: Type.Literal('decision'), value: Type.Union([Type.Literal('confirm'),
    Type.Literal('cancel'), Type.Literal('undo')]) }, STRICT),
]);
export type MessageWidgetAnswer = Static<typeof MessageWidgetAnswerSchema>;

/** 旧对话表里，作答记成的那条用户消息指回哪条消息的哪个部件（旧记录照旧读得出来）。 */
export const MessageAnswerToSchema = Type.Object({ messageId: IdSchema, widgetId: IdSchema }, STRICT);
export type MessageAnswerTo = Static<typeof MessageAnswerToSchema>;

// ---------- 给模型的 show_widgets 工具参数：只写内容，id、状态和对照数由服务端补 ----------

const DraftOption = Type.Object({
  label: Text(40),
  hint: Type.Optional(Text(80)),
  recommended: Type.Optional(Type.Boolean()),
}, STRICT);

export const WidgetDraftSchema = Type.Union([
  Type.Object({ kind: Type.Literal('image'), src: Type.String({ minLength: 1, maxLength: 2_000 }), alt: Text(200),
    caption: Type.Optional(Text(200)) }, STRICT),
  Type.Object({ kind: Type.Literal('choice'), prompt: Text(200),
    options: Type.Array(DraftOption, { minItems: 2, maxItems: WIDGET_CHOICE_OPTIONS_MAX }),
    multiple: Type.Optional(Type.Boolean()) }, STRICT),
  Type.Object({ kind: Type.Literal('input'), label: Text(80), placeholder: Type.Optional(Text(80)),
    submitLabel: Type.Optional(Text(12)), multiline: Type.Optional(Type.Boolean()) }, STRICT),
  Type.Object({ kind: Type.Literal('table'), caption: Type.Optional(Text(80)),
    columns: Type.Array(Type.Object({ key: Type.String({ minLength: 1, maxLength: 40 }), label: Text(20),
      align: Type.Optional(Type.Union([Type.Literal('start'), Type.Literal('end')])) }, STRICT),
    { minItems: 1, maxItems: WIDGET_TABLE_COLUMNS_MAX }),
    rows: Type.Array(Type.Record(Type.String(), Text(200)), { maxItems: WIDGET_TABLE_ROWS_MAX }) }, STRICT),
  Type.Object({ kind: Type.Literal('confirm'), text: Text(200), confirmLabel: Type.Optional(Text(12)),
    cancelLabel: Type.Optional(Text(12)) }, STRICT),
  Type.Object({ kind: Type.Literal('money'), amountCents: Type.Integer({ minimum: 1 }),
    currency: Type.Optional(Type.String({ minLength: 3, maxLength: 3 })), category: Text(20), note: Text(80),
    occurredAt: Type.Optional(IsoTimeSchema) }, STRICT),
]);
// 2026-11-05 专注、自建提醒和日历删掉：模型不再能放这三种工具卡（MessageWidgetSchema 里的旧形状留给旧客户端，
// 待客户端切完后删）。
export type WidgetDraft = Static<typeof WidgetDraftSchema>;
