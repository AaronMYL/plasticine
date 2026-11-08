// 正文上那一个弹出菜单是哪一种、按下去做什么：选中一段 → 引用 / 高亮 / 批注 / 复制；点高亮 → 换色 / 改批注 / 引用 /
// 删；点重点虚线 → 收下 / 不要；写批注 → 保存。写操作失败时菜单不关，把服务端那句话写在菜单里。

import { useState, type ReactNode } from 'react';
import { errorText } from '../../api/errors.ts';
import type { BookAnnotationView, HighlightColor } from '../../api/shared.ts';
import type { AnnotationActions } from './annotation-actions.ts';
import type { PendingKeyPoint } from './key-points.ts';
import { HighlightMenu, KeyPointMenu, NoteEditor, SelectionMenu, type AnchorRect } from './reader-popovers.tsx';

export type PopoverState =
  | { kind: 'selection'; start: number; end: number; rect: AnchorRect }
  | { kind: 'highlight'; annotationId: string; rect: AnchorRect }
  | { kind: 'note'; rect: AnchorRect; target: { kind: 'new'; start: number; end: number }
    | { kind: 'existing'; annotationId: string } }
  | { kind: 'key-point'; pointId: string; rect: AnchorRect };

export interface PopoverLayerProps {
  popover: PopoverState;
  chapter: number;
  chapterText: string;
  deviceLabel: string;
  annotations: readonly BookAnnotationView[];
  keyPoints: readonly PendingKeyPoint[];
  actions: AnnotationActions;
  /** 一段原文引用到对话（选区或已有高亮的位置）。 */
  onQuote: (start: number, end: number) => void;
  onChange: (next: PopoverState | null) => void;
  /** 写完一次：清掉正文里的选区。 */
  onDone: () => void;
  /** 重点「不要」之后重读重点。 */
  onDismissed: () => void;
}

// 新批注默认的颜色：第一种（赭黄）。
const NOTE_COLOR: HighlightColor = 'ochre';

export function PopoverLayer(props: PopoverLayerProps): ReactNode {
  const { popover } = props;
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const close = (): void => {
    setError(null);
    props.onChange(null);
  };
  const run = (work: () => Promise<unknown>): void => {
    setError(null);
    setSaving(true);
    work().then(() => {
      setSaving(false);
      props.onDone();
      close();
    }, (cause: unknown) => {
      setSaving(false);
      setError(errorText(cause));
    });
  };
  const annotation = (id: string): BookAnnotationView | undefined =>
    props.annotations.find((item) => item.id === id);
  const create = (start: number, end: number, color: HighlightColor, note?: string): Promise<unknown> =>
    props.actions.create({ chapter: props.chapter, start, end, chapterText: props.chapterText, color,
      deviceLabel: props.deviceLabel, ...(note === undefined ? {} : { note }) });
  if (popover.kind === 'selection') {
    const { start, end, rect } = popover;
    const copy = (): void => {
      const text = props.chapterText.slice(start, end);
      const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
      if (clipboard === undefined) {
        setError('这个浏览器不让网页写剪贴板，请用系统的「拷贝」。');
        return;
      }
      clipboard.writeText(text).then(close, (cause: unknown) => setError(`没复制上：${errorText(cause)}`));
    };
    return <SelectionMenu rect={rect} error={error} onClose={close} onCopy={copy}
      onQuote={() => {
        props.onQuote(start, end);
        props.onDone();
        close();
      }}
      onHighlight={(color) => run(() => create(start, end, color))}
      onNote={() => props.onChange({ kind: 'note', rect, target: { kind: 'new', start, end } })} />;
  }
  if (popover.kind === 'highlight') {
    const current = annotation(popover.annotationId);
    if (current === undefined) {
      return null;
    }
    return <HighlightMenu rect={popover.rect} color={current.color} note={current.note}
      plasticine={current.origin === 'plasticine'} error={error} onClose={close}
      onRecolor={(color) => run(() => props.actions.recolor(current, color))}
      onNote={() => props.onChange({ kind: 'note', rect: popover.rect,
        target: { kind: 'existing', annotationId: current.id } })}
      onQuote={() => {
        props.onQuote(current.start, current.end);
        close();
      }}
      onRemove={() => run(() => props.actions.remove(current))} />;
  }
  if (popover.kind === 'note') {
    const { target } = popover;
    const existing = target.kind === 'existing' ? annotation(target.annotationId) : undefined;
    return <NoteEditor rect={popover.rect} initial={existing?.note ?? ''} saving={saving} error={error}
      onClose={close}
      onSave={(note) => run(() => existing !== undefined ? props.actions.editNote(existing, note)
        : target.kind === 'new' ? create(target.start, target.end, NOTE_COLOR, note) : Promise.resolve())} />;
  }
  const point = props.keyPoints.find((item) => item.pointId === popover.pointId);
  if (point === undefined) {
    return null;
  }
  return <KeyPointMenu rect={popover.rect} text={point.text} error={error} onClose={close}
    onAccept={() => run(() => props.actions.accept(point.pointId, point, props.chapterText, props.deviceLabel))}
    onDismiss={() => run(async () => {
      await props.actions.dismiss(point.pointId);
      props.onDismissed();
    })} />;
}
