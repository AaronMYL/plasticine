// POST /v2/lines/:id/widgets（2026-11-05 部件作答搬到线上，替掉旧的 POST /v2/conversation/widgets）：
// 1. 找到带这个部件的那一步（show_widgets 的结果），按部件的种类检查答案，把答案和状态写回去；
// 2. 记账卡点确认才真正记上一笔、撤销拿掉（life/money，和记账页同一个写入口，记的来源是 brain：内容是 Plasticine 起草的）；
// 3. 选项、输入框、确认是他在回话：那句话发进这条线（空闲开一轮，在跑就排队，和发一条消息一样）；记账卡只记结果。
// 同一个 requestId 重发回同一个结果、不重做（idempotency.ts）。部件不碰用户确认字段。

import {
  AnswerLineWidgetRequestSchema,
  MessageWidgetSchema,
  type AnswerLineWidgetResponse,
  type MessageWidget,
  type MessageWidgetAnswer,
  type MoneyCard,
} from '../../shared/api/index.ts';
import { Value } from 'typebox/value';
import { BASE_CURRENCY, type AfterCommit, type MoneyDesk } from '../life/index.ts';
import type { StateService } from '../state/index.ts';
import { ApiError, notFoundError } from './api-error.ts';
import { param, requireUserAuth, type Reply, type RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotent } from './idempotency.ts';
import { kernel, lineCall } from './lines.ts';
import { checkInput } from './validate.ts';

interface Answered {
  widget: MessageWidget;
  /** 发进线里的那句话；记账卡是 null（只记结果）。 */
  say: string | null;
}

function wrongKind(): ApiError {
  return new ApiError(400, 'invalid_request', '这个答案和部件对不上。', { field: 'answer' });
}

function closed(what: string): ApiError {
  return new ApiError(409, 'conflict', `这个${what}已经答过了。`, { next: '刷新对话看现在的状态。' });
}

function yuan(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

function confirmMoney(card: MoneyCard, money: MoneyDesk, afterCommit: AfterCommit): MoneyCard {
  if (card.currency !== BASE_CURRENCY) {
    throw new ApiError(409, 'conflict', '记账卡只记人民币；外币请打开记账页记（要填汇率）。');
  }
  const category = money.categories().find((item) => item.name === card.category && item.kind === 'expense');
  if (category === undefined) {
    throw new ApiError(409, 'conflict', `记账类别「${card.category}」已经不在了，这笔没有记。`,
      { next: '在对话里再说一次，或者打开记账页记。' });
  }
  const entry = money.record({ kind: 'expense', amountCents: card.amountCents, currency: card.currency,
    categoryId: category.id, note: card.note, occurredAt: card.occurredAt, origin: 'brain' }, afterCommit);
  return { ...card, state: 'done', recordId: entry.id };
}

/** 记账卡要用的：记一笔、拿掉一笔（life/money），按 id 读回那一笔（state）。 */
export interface CardBooks {
  money: MoneyDesk;
  state: StateService;
}

function undoMoney(card: MoneyCard, books: CardBooks, afterCommit: AfterCommit): MoneyCard {
  const { money } = books;
  const recordId = card.recordId ?? null;
  const entry = recordId === null ? undefined : books.state.moneyEntries.get(recordId);
  if (entry !== undefined && entry.deletedAt === null) {
    money.remove(entry.id, entry.version, afterCommit);
  }
  return { ...card, state: 'draft', recordId: null };
}

function answerCard(widget: Extract<MessageWidget, { kind: 'tool' }>, answer: MessageWidgetAnswer,
  books: CardBooks, afterCommit: AfterCommit): MessageWidget {
  if (answer.kind !== 'decision') {
    throw wrongKind();
  }
  if (widget.tool !== 'money') {
    throw new ApiError(409, 'conflict', '专注、提醒和日历卡已经下线，这张卡点不了了。');
  }
  if (answer.value === 'undo') {
    if (widget.state === 'draft') {
      throw new ApiError(409, 'conflict', '这张卡还没做，不用撤销。');
    }
    return widget.state === 'done' ? undoMoney(widget, books, afterCommit) : { ...widget, state: 'draft' };
  }
  if (widget.state !== 'draft') {
    throw closed('卡');
  }
  return answer.value === 'cancel' ? { ...widget, state: 'cancelled' }
    : confirmMoney(widget, books.money, afterCommit);
}

/** 按部件的种类检查答案、算出新的部件和那句话；记账卡在这里真正记上或拿掉。 */
export function applyWidgetAnswer(widget: MessageWidget, answer: MessageWidgetAnswer, books: CardBooks,
  afterCommit: AfterCommit): Answered {
  switch (widget.kind) {
    case 'image':
    case 'table':
      throw new ApiError(400, 'invalid_request', '图片和表格不用作答。', { field: 'widgetId' });
    case 'choice': {
      if (answer.kind !== 'choice') {
        throw wrongKind();
      }
      const ids = [...new Set(answer.optionIds)];
      const known = new Set(widget.options.map((option) => option.id));
      if (ids.some((id) => !known.has(id)) || (!widget.multiple && ids.length !== 1)) {
        throw new ApiError(400, 'invalid_request', widget.multiple ? '选的项里有不在这组里的。' : '这组只能选一个。',
          { field: 'answer' });
      }
      const labels = widget.options.filter((option) => ids.includes(option.id)).map((option) => option.label);
      return { widget: { ...widget, answer: ids }, say: `选择：${labels.join('、')}（「${widget.prompt}」）` };
    }
    case 'input': {
      if (answer.kind !== 'input' || answer.text.trim() === '') {
        throw wrongKind();
      }
      const text = answer.text.trim();
      return { widget: { ...widget, answer: text }, say: `「${widget.label}」：${text}` };
    }
    case 'confirm': {
      if (answer.kind !== 'decision' || answer.value === 'undo') {
        throw wrongKind();
      }
      if (widget.state !== 'open') {
        throw closed('确认');
      }
      const yes = answer.value === 'confirm';
      return { widget: { ...widget, state: yes ? 'confirmed' : 'cancelled' },
        say: `「${widget.text}」：${yes ? widget.confirmLabel : widget.cancelLabel}` };
    }
    case 'tool':
      return { widget: answerCard(widget, answer, books, afterCommit), say: null };
  }
}

function widgetsIn(message: unknown): MessageWidget[] {
  const details: unknown = typeof message === 'object' && message !== null ? Reflect.get(message, 'details')
    : undefined;
  const widgets: unknown = typeof details === 'object' && details !== null ? Reflect.get(details, 'widgets')
    : undefined;
  return Array.isArray(widgets) ? widgets.filter((widget): widget is MessageWidget =>
    Value.Check(MessageWidgetSchema, widget)) : [];
}

/** POST /v2/lines/:id/widgets */
export async function answerLineWidget(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const lines = kernel(context);
  const body = checkInput(AnswerLineWidgetRequestSchema, await readJsonBody(context.req), '部件作答');
  const { state, m5b } = context.deps;
  return idempotent(context, body.requestId, (afterCommit) => lineCall(() => {
    const line = lines.line(param(context, 'id'));
    const row = state.lineMessages.withWidget(line.id, body.widgetId);
    const message = row?.message;
    const widget = widgetsIn(message).find((item) => item.id === body.widgetId);
    if (row === undefined || widget === undefined) {
      throw notFoundError('这个部件');
    }
    const answered = applyWidgetAnswer(widget, body.answer, { money: m5b.life.money, state }, afterCommit);
    const details = Reflect.get(message as object, 'details') as Record<string, unknown>;
    const widgets = widgetsIn(message).map((item) => (item.id === widget.id ? answered.widget : item));
    state.lineMessages.replace(line.id, row.seq, { ...(message as object), details: { ...details, widgets } });
    const updated = lines.touched(line.id, row.seq, afterCommit);
    if (answered.say === null) {
      const response: AnswerLineWidgetResponse = { line: lines.view(line.id), message: updated,
        outcome: 'recorded' };
      return { status: 200, body: response };
    }
    const sent = lines.send(line.id,
      { text: answered.say, origin: { kind: 'user', userText: answered.say } }, afterCommit);
    const response: AnswerLineWidgetResponse = { line: sent.line, message: updated, outcome: sent.outcome };
    return { status: 200, body: response };
  }));
}
