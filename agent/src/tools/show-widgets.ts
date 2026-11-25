import { randomUUID } from 'node:crypto';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import {
  MESSAGE_WIDGETS_MAX,
  MessageWidgetSchema,
  WidgetDraftSchema,
  type MessageWidget,
  type WidgetDraft,
} from '../../shared/api/message-widgets.ts';
import { defineTool, type Tool } from './registry.ts';

const SHOW_TIMEOUT_MS = 2_000;
const DEFAULT_CURRENCY = 'CNY';

export interface WidgetFacts {
  moneyCategories(): string[];
  monthCategoryCents(category: string, occurredAt: string, amountCents: number): number | null;
}

export interface WidgetRecorder {
  shown(runId: string, callId: string, widgets: MessageWidget[]): void;
}

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
}

export function buildWidget(draft: WidgetDraft, facts: WidgetFacts, now: Date): MessageWidget {
  const id = newId('w');
  switch (draft.kind) {
    case 'image':
      if (!/^(https:\/\/|\/v2\/attachments\/)/.test(draft.src)) {
        throw new Error('图片地址只能是 https:// 网址或附件的内容地址（/v2/attachments/<id>/content）。');
      }
      return { kind: 'image', id, src: draft.src, alt: draft.alt,
        ...(draft.caption === undefined ? {} : { caption: draft.caption }) };
    case 'choice':
      return { kind: 'choice', id, prompt: draft.prompt, multiple: draft.multiple ?? false, answer: null,
        options: draft.options.map((option, index) => ({ id: `o${index + 1}`, label: option.label,
          ...(option.hint === undefined ? {} : { hint: option.hint }),
          ...(option.recommended === true ? { recommended: true } : {}) })) };
    case 'input':
      return { kind: 'input', id, label: draft.label, placeholder: draft.placeholder ?? '',
        submitLabel: draft.submitLabel ?? '好', multiline: draft.multiline ?? false, answer: null };
    case 'table':
      return { kind: 'table', id, columns: draft.columns, rows: draft.rows,
        ...(draft.caption === undefined ? {} : { caption: draft.caption }),
        ...(draft.total === true ? { total: true } : {}) };
    case 'chart':
      return { kind: 'chart', id, type: draft.type, series: draft.series,
        ...(draft.title === undefined ? {} : { title: draft.title }),
        ...(draft.unit === undefined ? {} : { unit: draft.unit }) };
    case 'confirm':
      return { kind: 'confirm', id, text: draft.text, confirmLabel: draft.confirmLabel ?? '好',
        cancelLabel: draft.cancelLabel ?? '先不', state: 'open' };
    case 'money': {
      const categories = facts.moneyCategories();
      if (!categories.includes(draft.category)) {
        throw new Error(`记账类别「${draft.category}」不存在，可用的类别：${categories.join('、')}。`);
      }
      if ((draft.currency ?? DEFAULT_CURRENCY) !== DEFAULT_CURRENCY) {
        throw new Error('记账卡只记人民币（CNY）；外币让用户打开记账页记，要填汇率。');
      }
      const occurredAt = draft.occurredAt ?? now.toISOString();
      return { kind: 'tool', tool: 'money', id, state: 'draft', amountCents: draft.amountCents,
        currency: draft.currency ?? DEFAULT_CURRENCY, category: draft.category, note: draft.note, occurredAt,
        monthCategoryCents: facts.monthCategoryCents(draft.category, occurredAt, draft.amountCents), recordId: null };
    }
  }
}

const KIND_TEXT: Record<WidgetDraft['kind'], string> = {
  image: '图片', choice: '选项', input: '输入框', table: '表格', chart: '图表', confirm: '确认按钮',
  money: '记账卡',
};

export function createShowWidgetsTool(facts: WidgetFacts, recorder: WidgetRecorder): Tool {
  return defineTool({
    name: 'show_widgets',
    label: '在回复里放部件',
    description: '在这条回答下面放能点的小部件（显示在对话里，点一下就答）：choice 代替开放式提问，input 要一个具体答案，table 放结构化结果（数字列 align end，要合计就 total），'
      + 'chart 画数字的走势或对比（bar 比大小、line 看走势、scatter 看两样的关系），confirm 代替问「要不要我……？」，'
      + '记账卡放一笔要记的付款。卡片只是草稿：他点了确认才写进去。回答会作为一条消息回到这条线。',
    replay: 'safe',
    effect: 'internal',
    permission: 'auto',
    roles: ['conversation'],
    timeoutMs: SHOW_TIMEOUT_MS,
    parameters: Type.Object({
      widgets: Type.Array(WidgetDraftSchema, { minItems: 1, maxItems: MESSAGE_WIDGETS_MAX }),
    }, { additionalProperties: false }),
    async execute(args, context) {
      const now = context.now();
      const widgets = args.widgets.map((draft) => buildWidget(draft, facts, now));
      widgets.forEach((widget, index) => {
        if (!Value.Check(MessageWidgetSchema, widget)) {
          throw new Error(`第 ${index + 1} 个部件的内容不合格式，按参数说明改好再放。`);
        }
      });
      recorder.shown(context.runId, context.callId, widgets);
      const names = args.widgets.map((draft) => KIND_TEXT[draft.kind]).join('、');
      return JSON.stringify({ shown: names,
        note: '已放在这次回复下面。回复里不要再把选项或卡片内容逐条写一遍；他作答会作为一条消息回到这条线里。' });
    },
  });
}
