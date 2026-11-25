// SPDX-License-Identifier: Apache-2.0

import { Type, type Static } from 'typebox';
import { IdSchema, IsoTimeSchema } from './common.ts';

export const MESSAGE_WIDGETS_MAX = 8;
export const WIDGET_CHOICE_OPTIONS_MAX = 8;
export const WIDGET_TABLE_ROWS_MAX = 50;
export const WIDGET_TABLE_COLUMNS_MAX = 8;
export const CALENDAR_AROUND_MAX = 12;

const STRICT = { additionalProperties: false };
const Text = (max: number) => Type.String({ maxLength: max });

export const ImageWidgetSchema = Type.Object({
  kind: Type.Literal('image'),
  id: IdSchema,
  src: Type.String({ minLength: 1, maxLength: 200_000 }),
  alt: Text(200),
  width: Type.Optional(Type.Integer({ minimum: 1 })),
  height: Type.Optional(Type.Integer({ minimum: 1 })),
  caption: Type.Optional(Text(200)),
}, STRICT);

export const FileWidgetSchema = Type.Object({
  kind: Type.Literal('file'),
  id: IdSchema,
  attachmentId: IdSchema,
  name: Text(200),
  mimeType: Type.String({ minLength: 3, maxLength: 160 }),
  bytes: Type.Integer({ minimum: 1 }),
  path: Type.Optional(Text(1_000)),
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
  total: Type.Optional(Type.Boolean()),
}, STRICT);

export function tableNumber(text: string): number | null {
  const clean = text.trim().replace(/^[¥￥$]\s*/, '').replaceAll(',', '');
  return /^-?(\d+(\.\d+)?|\.\d+)$/.test(clean) ? Number(clean) : null;
}

export const WIDGET_CHART_SERIES_MAX = 6;
export const WIDGET_CHART_POINTS_MAX = 60;
const ChartPoint = Type.Object({ x: Type.Union([Text(40), Type.Number()]), y: Type.Number() }, STRICT);
const ChartBody = {
  title: Type.Optional(Text(80)),
  type: Type.Union([Type.Literal('bar'), Type.Literal('line'), Type.Literal('scatter')]),
  unit: Type.Optional(Text(12)),
  series: Type.Array(Type.Object({ name: Text(20), points: Type.Array(ChartPoint, { minItems: 1,
    maxItems: WIDGET_CHART_POINTS_MAX }) }, STRICT), { minItems: 1, maxItems: WIDGET_CHART_SERIES_MAX }),
};

export const ChartWidgetSchema = Type.Object({ kind: Type.Literal('chart'), id: IdSchema, ...ChartBody }, STRICT);

export const CONFIRM_STATES = ['open', 'confirmed', 'cancelled'] as const;

export const ConfirmWidgetSchema = Type.Object({
  kind: Type.Literal('confirm'),
  id: IdSchema,
  text: Text(200),
  confirmLabel: Text(12),
  cancelLabel: Text(12),
  state: Type.Union([Type.Literal('open'), Type.Literal('confirmed'), Type.Literal('cancelled')]),
}, STRICT);

export const TOOL_CARD_STATES = ['draft', 'done', 'cancelled'] as const;
const ToolCardState = Type.Union([Type.Literal('draft'), Type.Literal('done'), Type.Literal('cancelled')]);
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
  FileWidgetSchema,
  ChoiceWidgetSchema,
  InputWidgetSchema,
  TableWidgetSchema,
  ChartWidgetSchema,
  ConfirmWidgetSchema,
  ToolCardSchema,
]);

export type ImageWidget = Static<typeof ImageWidgetSchema>;
export type FileWidget = Static<typeof FileWidgetSchema>;
export type ChoiceWidget = Static<typeof ChoiceWidgetSchema>;
export type InputWidget = Static<typeof InputWidgetSchema>;
export type TableWidget = Static<typeof TableWidgetSchema>;
export type ChartWidget = Static<typeof ChartWidgetSchema>;
export type ConfirmWidget = Static<typeof ConfirmWidgetSchema>;
export type MoneyCard = Static<typeof MoneyCardSchema>;
export type FocusCard = Static<typeof FocusCardSchema>;
export type ReminderCard = Static<typeof ReminderCardSchema>;
export type CalendarCard = Static<typeof CalendarCardSchema>;
export type ToolCard = Static<typeof ToolCardSchema>;
export type MessageWidget = Static<typeof MessageWidgetSchema>;

export const MessageWidgetAnswerSchema = Type.Union([
  Type.Object({ kind: Type.Literal('choice'), optionIds: Type.Array(IdSchema, { minItems: 1 }) }, STRICT),
  Type.Object({ kind: Type.Literal('input'), text: Type.String({ minLength: 1, maxLength: 2_000 }) }, STRICT),
  Type.Object({ kind: Type.Literal('decision'), value: Type.Union([Type.Literal('confirm'),
    Type.Literal('cancel'), Type.Literal('undo')]) }, STRICT),
]);
export type MessageWidgetAnswer = Static<typeof MessageWidgetAnswerSchema>;

export const MessageAnswerToSchema = Type.Object({ messageId: IdSchema, widgetId: IdSchema }, STRICT);
export type MessageAnswerTo = Static<typeof MessageAnswerToSchema>;

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
    rows: Type.Array(Type.Record(Type.String(), Text(200)), { maxItems: WIDGET_TABLE_ROWS_MAX }),
    total: Type.Optional(Type.Boolean()) }, STRICT),
  Type.Object({ kind: Type.Literal('chart'), ...ChartBody }, STRICT),
  Type.Object({ kind: Type.Literal('confirm'), text: Text(200), confirmLabel: Type.Optional(Text(12)),
    cancelLabel: Type.Optional(Text(12)) }, STRICT),
  Type.Object({ kind: Type.Literal('money'), amountCents: Type.Integer({ minimum: 1 }),
    currency: Type.Optional(Type.String({ minLength: 3, maxLength: 3 })), category: Text(20), note: Text(80),
    occurredAt: Type.Optional(IsoTimeSchema) }, STRICT),
]);
export type WidgetDraft = Static<typeof WidgetDraftSchema>;
