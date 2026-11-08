// 一条消息带的部件（agent/shared/api/message-widgets.ts）：图片排成一格一格放在最前面，其余按消息里的顺序一个一个排。
// 作答发到这条线（POST /v2/lines/:id/widgets）：点了先按本机这一份显示，回执到了换成回执里的部件
// （state/widget-answers.ts）；没送到退回原样，写一句原因。

import type { ReactNode } from 'react';
import { useApi } from '../../../api/context.tsx';
import { errorText, isUncertain } from '../../../api/errors.ts';
import type { ImageWidget, MessageWidget, MessageWidgetAnswer } from '../../../api/shared.ts';
import { useClientState } from '../../../state/context.tsx';
import { useStore } from '../../../state/use-store.ts';
import { widgetKey } from '../../../state/widget-answers.ts';
import { ImageGallery, TableWidgetView } from './basic-widgets.tsx';
import { ChoiceWidgetView, ConfirmWidgetView, InputWidgetView, type AnswerProps } from './form-widgets.tsx';
import { ToolCardView } from './tool-cards.tsx';
import './widgets.css';

function One({ widget, answer }: { widget: Exclude<MessageWidget, ImageWidget>; answer: AnswerProps }): ReactNode {
  switch (widget.kind) {
    case 'choice': return <ChoiceWidgetView widget={widget} {...answer} />;
    case 'input': return <InputWidgetView widget={widget} {...answer} />;
    case 'confirm': return <ConfirmWidgetView widget={widget} {...answer} />;
    case 'table': return <TableWidgetView widget={widget} />;
    case 'tool': return <ToolCardView card={widget} {...answer} />;
  }
}

/** 点了「改」的选项、输入框：按没答过摆出来。 */
function unanswered(widget: Exclude<MessageWidget, ImageWidget>): Exclude<MessageWidget, ImageWidget> {
  return widget.kind === 'choice' || widget.kind === 'input' ? { ...widget, answer: null } : widget;
}

export interface MessageWidgetsProps {
  /** 部件在哪条线上：作答发到这条线。 */
  lineId: string;
  /** 本机作答状态的键（同一条消息里的部件 id 不重）。 */
  messageId: string;
  widgets: MessageWidget[];
  /** 工具卡上点「改」：把一句「改一下…」放进输入框（视图层给，部件不认识输入框）。 */
  onEditCard?: ((text: string) => void) | undefined;
}

export function MessageWidgets({ lineId, messageId, widgets, onEditCard }: MessageWidgetsProps): ReactNode {
  const api = useApi();
  const { widgetAnswers } = useClientState();
  const answers = useStore(widgetAnswers.store);
  if (widgets.length === 0) {
    return null;
  }
  const send = (widgetId: string, answer: MessageWidgetAnswer): void => {
    const key = widgetKey(messageId, widgetId);
    const requestId = widgetAnswers.begin(key, answer);
    api.lines.answerWidget(lineId, { requestId, widgetId, answer }).then(() => {
      widgetAnswers.settle(key);
    }, (cause: unknown) => {
      const uncertain = isUncertain(cause);
      widgetAnswers.fail(key, uncertain ? '没确定答上了没有：再点一次同样的答案核实，不会重复。' : errorText(cause),
        uncertain);
    });
  };
  const images = widgets.filter((widget): widget is ImageWidget => widget.kind === 'image');
  const rest = widgets.filter((widget): widget is Exclude<MessageWidget, ImageWidget> => widget.kind !== 'image');
  return (
    <div className="msg-widgets">
      <ImageGallery images={images} />
      {rest.map((widget) => {
        const key = widgetKey(messageId, widget.id);
        const local = answers.get(key);
        const shown = local?.editing === true && local.sending === null ? unanswered(widget) : widget;
        const props: AnswerProps = {
          answer: local?.sending ?? null,
          onAnswer: (answer) => send(widget.id, answer),
          onReset: widget.kind === 'tool' ? () => send(widget.id, { kind: 'decision', value: 'undo' })
            : () => widgetAnswers.edit(key),
          ...(onEditCard === undefined ? {} : { onEdit: onEditCard }),
        };
        return (
          <div key={widget.id} className="msg-widget-slot">
            <One widget={shown} answer={props} />
            {local?.error == null ? null : <p className="widget-error" role="alert">{local.error}</p>}
          </div>
        );
      })}
    </div>
  );
}
