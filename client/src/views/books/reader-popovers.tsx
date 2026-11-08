// 正文上的小菜单（弹出菜单，--lift）：选中一段时「引用到对话 · 四色 · 批注 · 复制」，点已有高亮时换颜色 / 改批注 /
// 删，写批注的就地编辑，点 Plasticine 标的重点时「收下 / 不要」。都放在那段文字下面，手机上也一样。
// 按下菜单里的按钮不抢走正文的选区（mousedown 不做默认动作），写批注的输入框例外。

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { HIGHLIGHT_COLORS, type HighlightColor } from '../../api/shared.ts';
import { useDismiss } from '../../shell/use-dismiss.ts';

export interface AnchorRect {
  top: number;
  bottom: number;
  left: number;
}

export const COLOR_NAMES: Readonly<Record<HighlightColor, string>> = {
  ochre: '赭黄',
  sage: '灰绿',
  slate: '灰蓝',
  rose: '灰粉',
};

// 菜单和那段文字之间留 8（间距令牌）。
const GAP = 8;

interface FrameProps {
  rect: AnchorRect;
  label: string;
  onClose: () => void;
  /** 写批注时要能点进输入框，不拦 mousedown。 */
  editable?: boolean;
  children: ReactNode;
}

function PopoverFrame({ rect, label, onClose, editable = false, children }: FrameProps): ReactNode {
  const frame = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState(rect.left);
  useLayoutEffect(() => {
    const node = frame.current;
    const container = node?.offsetParent;
    if (node === null || !(container instanceof HTMLElement)) {
      return;
    }
    setLeft(Math.max(0, Math.min(rect.left, container.clientWidth - node.offsetWidth)));
  }, [rect.left]);
  // 点外面、Esc、窗口失焦、切页、缩放都收（use-dismiss.ts）。它跟着正文一起滚，滚出视野才收。
  useDismiss({ open: true, inside: [frame], anchor: frame, onDismiss: () => onClose() });
  return (
    <div ref={frame} className={editable ? 'bk-pop bk-pop-editor' : 'bk-pop'} role="dialog" aria-label={label}
      style={{ top: rect.bottom + GAP, left }}
      onMouseDown={editable ? undefined : (event) => event.preventDefault()}>
      {children}
    </div>
  );
}

interface SwatchesProps {
  current?: HighlightColor;
  onPick: (color: HighlightColor) => void;
}

function Swatches({ current, onPick }: SwatchesProps): ReactNode {
  return (
    <span className="bk-swatches" role="group" aria-label="高亮颜色">
      {HIGHLIGHT_COLORS.map((color) => (
        <button key={color} type="button" className="bk-swatch-button" aria-label={`高亮成${COLOR_NAMES[color]}`}
          aria-pressed={current === undefined ? undefined : current === color} onClick={() => onPick(color)}>
          <span className="bk-swatch" data-c={color} />
        </button>
      ))}
    </span>
  );
}

function ErrorLine({ error }: { error: string | null }): ReactNode {
  return error === null ? null : <p className="bk-pop-error" role="alert">{error}</p>;
}

export interface SelectionMenuProps {
  rect: AnchorRect;
  error: string | null;
  onQuote: () => void;
  onHighlight: (color: HighlightColor) => void;
  onNote: () => void;
  onCopy: () => void;
  onClose: () => void;
}

export function SelectionMenu(props: SelectionMenuProps): ReactNode {
  return (
    <PopoverFrame rect={props.rect} label="选中的这段" onClose={props.onClose}>
      <div className="bk-pop-row">
        <button type="button" className="bk-pop-main" onClick={props.onQuote}>引用到对话</button>
        <i aria-hidden="true" />
        <Swatches onPick={props.onHighlight} />
        <i aria-hidden="true" />
        <button type="button" onClick={props.onNote}>批注</button>
        <button type="button" onClick={props.onCopy}>复制</button>
      </div>
      <ErrorLine error={props.error} />
    </PopoverFrame>
  );
}

export interface HighlightMenuProps {
  rect: AnchorRect;
  color: HighlightColor;
  note: string | null;
  plasticine: boolean;
  error: string | null;
  onRecolor: (color: HighlightColor) => void;
  onNote: () => void;
  onQuote: () => void;
  onRemove: () => void;
  onClose: () => void;
}

export function HighlightMenu(props: HighlightMenuProps): ReactNode {
  return (
    <PopoverFrame rect={props.rect} label="这条高亮" onClose={props.onClose}>
      {props.plasticine ? <p className="bk-pop-note"><span className="tag tag-outline-quiet">
        Plasticine 标的 · 已收下</span></p> : null}
      {props.note === null ? null : <p className="bk-pop-note"><b>批注</b>{props.note}</p>}
      <div className="bk-pop-row">
        <Swatches current={props.color} onPick={props.onRecolor} />
        <i aria-hidden="true" />
        <button type="button" onClick={props.onNote}>{props.note === null ? '批注' : '改批注'}</button>
        <button type="button" onClick={props.onQuote}>引用到对话</button>
        <button type="button" onClick={props.onRemove}>删除</button>
      </div>
      <ErrorLine error={props.error} />
    </PopoverFrame>
  );
}

export interface NoteEditorProps {
  rect: AnchorRect;
  initial: string;
  saving: boolean;
  error: string | null;
  onSave: (note: string) => void;
  onClose: () => void;
}

export function NoteEditor(props: NoteEditorProps): ReactNode {
  const [text, setText] = useState(props.initial);
  return (
    <PopoverFrame rect={props.rect} label="写批注" onClose={props.onClose} editable>
      <textarea className="bk-note-input" aria-label="批注" value={text} autoFocus rows={3}
        placeholder="写下你的想法" onChange={(event) => setText(event.target.value)} />
      <ErrorLine error={props.error} />
      <div className="bk-pop-actions">
        <button type="button" className="text-button text-button-quiet" onClick={props.onClose}>取消</button>
        <button type="button" className="primary-button" disabled={props.saving}
          onClick={() => props.onSave(text)}>{props.saving ? '正在保存…' : '保存'}</button>
      </div>
    </PopoverFrame>
  );
}

export interface KeyPointMenuProps {
  rect: AnchorRect;
  text: string;
  error: string | null;
  onAccept: () => void;
  onDismiss: () => void;
  onClose: () => void;
}

export function KeyPointMenu(props: KeyPointMenuProps): ReactNode {
  return (
    <PopoverFrame rect={props.rect} label="Plasticine 标的重点" onClose={props.onClose}>
      <p className="bk-pop-note"><b>Plasticine 标的重点</b>{props.text}</p>
      <div className="bk-pop-row">
        <button type="button" onClick={props.onAccept}>收下</button>
        <button type="button" onClick={props.onDismiss}>不要</button>
      </div>
      <ErrorLine error={props.error} />
    </PopoverFrame>
  );
}
