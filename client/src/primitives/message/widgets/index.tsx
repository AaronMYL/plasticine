import type { ReactNode } from 'react';
import { useApi } from '../../../api/context.tsx';
import { errorText, isUncertain } from '../../../api/errors.ts';
import type { FileWidget, ImageWidget, MessageWidget, MessageWidgetAnswer } from '../../../api/shared.ts';
import { useClientState } from '../../../state/context.tsx';
import { useStore } from '../../../state/use-store.ts';
import { widgetKey } from '../../../state/widget-answers.ts';
import { ImageGallery } from './basic-widgets.tsx';
import { ChartWidgetView } from './chart-widget.tsx';
import { ChoiceWidgetView, ConfirmWidgetView, InputWidgetView, type AnswerProps } from './form-widgets.tsx';
import { TableWidgetView } from './table-widget.tsx';
import { ToolCardView } from './tool-cards.tsx';
import './widgets.css';

type Drawn = Exclude<MessageWidget, ImageWidget | FileWidget>;

function One({ widget, answer }: { widget: Drawn; answer: AnswerProps }): ReactNode {
  switch (widget.kind) {
    case 'choice': return <ChoiceWidgetView widget={widget} {...answer} />;
    case 'input': return <InputWidgetView widget={widget} {...answer} />;
    case 'confirm': return <ConfirmWidgetView widget={widget} {...answer} />;
    case 'table': return <TableWidgetView widget={widget} />;
    case 'chart': return <ChartWidgetView widget={widget} />;
    case 'tool': return <ToolCardView card={widget} {...answer} />;
  }
}

function unanswered(widget: Drawn): Drawn {
  return widget.kind === 'choice' || widget.kind === 'input' ? { ...widget, answer: null } : widget;
}

export interface MessageWidgetsProps {
  lineId: string;
  messageId: string;
  widgets: MessageWidget[];
  onEditCard?: ((text: string) => void) | undefined;
}

export function MessageWidgets({ lineId, messageId, widgets, onEditCard }: MessageWidgetsProps): ReactNode {
  const api = useApi();
  const { widgetAnswers } = useClientState();
  const answers = useStore(widgetAnswers.store);
  if (widgets.every((widget) => widget.kind === 'file')) {
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
  const rest = widgets.filter((widget): widget is Drawn => widget.kind !== 'image' && widget.kind !== 'file');
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
