import { ApiError } from '../errors.ts';
import type { MessageWidget, MessageWidgetAnswer } from '../shared.ts';

function invalid(message: string): ApiError {
  return new ApiError({ kind: 'invalid', code: 'invalid_request', status: 400, message });
}

export function answerFakeWidget(widget: MessageWidget, answer: MessageWidgetAnswer, serial: number)
  : { widget: MessageWidget; say: string | null } {
  if (widget.kind === 'choice' && answer.kind === 'choice') {
    const labels = widget.options.filter((option) => answer.optionIds.includes(option.id))
      .map((option) => option.label);
    return { widget: { ...widget, answer: [...answer.optionIds] },
      say: `选择：${labels.join('、')}（「${widget.prompt}」）` };
  }
  if (widget.kind === 'input' && answer.kind === 'input') {
    return { widget: { ...widget, answer: answer.text.trim() }, say: `「${widget.label}」：${answer.text.trim()}` };
  }
  if (widget.kind === 'confirm' && answer.kind === 'decision' && answer.value !== 'undo') {
    const yes = answer.value === 'confirm';
    return { widget: { ...widget, state: yes ? 'confirmed' : 'cancelled' },
      say: `「${widget.text}」：${yes ? widget.confirmLabel : widget.cancelLabel}` };
  }
  if (widget.kind === 'tool' && answer.kind === 'decision') {
    if (answer.value === 'undo') {
      return { widget: { ...widget, state: 'draft', recordId: null }, say: null };
    }
    return { widget: answer.value === 'confirm' ? { ...widget, state: 'done', recordId: `fake-money-${serial}` }
      : { ...widget, state: 'cancelled' }, say: null };
  }
  throw invalid('这个答案和部件对不上。');
}
