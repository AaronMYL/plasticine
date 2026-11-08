// show_widgets（2026-11-03 shell3，用户要求「对话记录要像聊天一样直观」）：Plasticine 在这一轮的回复里放部件——
// 选项代替开放式提问、输入框要一句具体的话、表格摆结构化结果、确认按钮代替「要我做吗」，记账 / 专注 / 提醒 / 日历的
// 轻操作放工具卡（用户点确认才真正写进去，见 app/widget-answers.ts）。这个工具自己不写任何用户数据：它把模型给的内容
// 补齐 id、状态和对照数（本月这一类花了多少、今天专注了多少、那天已有的安排），按 schema 校验，记成这一轮的
// widgets_shown 事件；回复存下时挂到这条回复上（brain/conversation.ts）。

import { randomUUID } from 'node:crypto';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import {
  MESSAGE_WIDGETS_MAX,
  MessageWidgetSchema,
  WidgetDraftSchema,
  type MessageWidget,
  type WidgetDraft,
} from '../../../shared/api/message-widgets.ts';
import { defineTool, type Tool } from './registry.ts';

/** 只读一下就回：慢于这个是出了问题。 */
const SHOW_TIMEOUT_MS = 2_000;
const DEFAULT_CURRENCY = 'CNY';

/** 服务端补对照数要读的东西（app/ 用 life/ 实现后注入；只读）。 */
export interface WidgetFacts {
  /** 记账的类别名（工具卡只能用这里有的）。 */
  moneyCategories(): string[];
  /** 记上这一笔之后，本月这一类一共多少（分）；算不出是 null。 */
  monthCategoryCents(category: string, occurredAt: string, amountCents: number): number | null;
}

export interface WidgetRecorder {
  /** 记成这一轮的 widgets_shown 事件（回复存下时挂上去）。 */
  shown(runId: string, callId: string, widgets: MessageWidget[]): void;
}

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
}

/** 模型给的一份草稿 → 消息里的部件；内容不对（类别不存在、时间倒了）抛错，告诉模型怎么改。 */
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
        ...(draft.caption === undefined ? {} : { caption: draft.caption }) };
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
  image: '图片', choice: '选项', input: '输入框', table: '表格', confirm: '确认按钮',
  money: '记账卡',
};

export function createShowWidgetsTool(facts: WidgetFacts, recorder: WidgetRecorder): Tool {
  return defineTool({
    name: 'show_widgets',
    label: '在回复里放部件',
    description:
      'Puts interactive pieces under this reply (shown in the chat, answered with one tap): choice instead of an '
      + 'open question, input for one specific answer, table for structured results, confirm instead of asking '
      + '"shall I?", and the money tool card for a payment to record. Tool cards only draft: nothing is written '
      + 'until the user taps confirm. Answers come back as a message in this line.',
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
