// 一条笔记建议怎么贴着正文画：续写是光标后的灰字，补充是这一段下方的一句话加「加上」/ ×。
// 两条同时在时（2026-11-04 用户定），补充排在续写灰字多出来的几行下面，不叠在一起。

import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/core';
import type { Node as DocumentNode } from '@tiptap/pm/model';
import { useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent,
  type ReactNode } from 'react';
import type { NoteSupplement } from '../../api/shared.ts';
import { IconButton } from '../../shell/icon-button.tsx';
import { editorDom, useEditorDom } from './editor-dom.ts';
import { baseMargin, setSuggestionSpace, suggestionSpaces, type SuggestionKind } from './note-suggestion-space.ts';

/** 补充建议放在当前段落下方，和上下段各留这么多空。 */
const INTERJECT_GAP = 8;
export interface Suggestion {
  text: string; position: number; kind: SuggestionKind; doc: DocumentNode;
  items?: NoteSupplement[];
  range?: { from: number; to: number };
}
const TYPE_NAMES = { structure: '结构', supplement: '补充', example: '举例', contact: '联系人' } as const;
interface SuggestionLayout {
  body: Element; top: number; left: number; width: number; indent: number; line: number; margin: number;
  font: CSSProperties;
}
/** 点建议时不让编辑器失焦：失焦会撤掉建议，光标也会离开采用的位置。 */
const keepFocus = {
  onPointerDown: (event: PointerEvent) => event.preventDefault(),
  onMouseDown: (event: MouseEvent) => event.preventDefault(),
};

function measure(editor: Editor, suggestion: Suggestion): SuggestionLayout | null {
  const dom = editorDom(editor);
  if (dom === null || editor.state.doc !== suggestion.doc) { return null; }
  const body = dom.closest('.note-body');
  if (body === null) { return null; }
  const position = editor.state.doc.resolve(suggestion.position);
  const block = position.depth === 0 ? dom : editor.view.nodeDOM(position.before());
  if (!(block instanceof HTMLElement)) { return null; }
  const box = block.getBoundingClientRect();
  const font = getComputedStyle(block);
  const line = Number.parseFloat(font.lineHeight) || 28;
  const left = box.left + (Number.parseFloat(font.paddingLeft) || 0)
    + (Number.parseFloat(font.borderLeftWidth) || 0);
  const right = box.right - (Number.parseFloat(font.paddingRight) || 0)
    - (Number.parseFloat(font.borderRightWidth) || 0);
  const width = Math.max(1, right - left);
  const bounds = body.getBoundingClientRect();
  const margin = baseMargin(editor.state, suggestion.position, Number.parseFloat(font.marginBottom) || 0);
  if (suggestion.kind === 'interject') {
    // 续写灰字折出来的几行在段落下方，补充接在它们后面。
    const predicted = suggestionSpaces(editor.state).predict;
    const below = predicted?.position === suggestion.position ? predicted.space : 0;
    return { body, left: left - bounds.left, width, line, margin, indent: 0, font: {},
      top: box.bottom - bounds.top + below + INTERJECT_GAP };
  }
  const point = editor.view.coordsAtPos(suggestion.position);
  return { body, left: left - bounds.left, width, line, margin,
    top: point.top - (line - (point.bottom - point.top)) / 2 - bounds.top,
    indent: Math.max(0, Math.min(width, point.left - left)),
    font: { font: font.font, letterSpacing: font.letterSpacing, lineHeight: `${line}px` },
  };
}

function sameLayout(a: SuggestionLayout | null, b: SuggestionLayout): boolean {
  return a !== null && a.body === b.body && a.top === b.top && a.left === b.left && a.width === b.width
    && a.indent === b.indent && a.line === b.line && a.margin === b.margin
    && JSON.stringify(a.font) === JSON.stringify(b.font);
}

/**
 * 建议画在 contenteditable 外、贴着光标所在段落。只给原段落留出空间（装饰加下边距），不往正文里插节点。
 * 另一条建议出现或撤下会改段落的边距：跟着编辑器的每次变化重量一遍，量出来一样就不重画。
 */
export function InlineSuggestion({ editor, suggestion, onAdopt, onDismiss }: {
  editor: Editor; suggestion: Suggestion; onAdopt: (item?: NoteSupplement) => void; onDismiss: () => void;
}): ReactNode {
  const [layout, setLayout] = useState<SuggestionLayout | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<NoteSupplement | null>(null);
  const interject = suggestion.kind === 'interject';
  const dom = useEditorDom(editor);
  useLayoutEffect(() => {
    if (dom === null) { return; }
    const place = (): void => {
      const next = measure(editor, suggestion);
      if (next !== null) { setLayout((previous) => sameLayout(previous, next) ? previous : next); }
    };
    place();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    observer?.observe(dom);
    window.addEventListener('resize', place);
    editor.on('transaction', place);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', place);
      editor.off('transaction', place);
    };
  }, [editor, dom, suggestion]);
  useLayoutEffect(() => {
    if (layout === null || box.current === null || editor.isDestroyed) { return; }
    const height = box.current.getBoundingClientRect().height;
    const space = Math.max(0, Math.ceil(interject ? height + INTERJECT_GAP * 2 : height - layout.line));
    setSuggestionSpace(editor, suggestion.kind, { position: suggestion.position, space, margin: layout.margin });
  }, [editor, layout, suggestion, interject, draft]);
  useLayoutEffect(() => () => setSuggestionSpace(editor, suggestion.kind, null), [editor, suggestion.kind]);
  if (layout === null) { return null; }
  const place = { left: layout.left, width: layout.width, top: layout.top };
  if (interject) {
    return createPortal(<div ref={box} className="note-suggestion" role="group" aria-label="补充建议" style={place}>
      <header><span>✦ 补充建议</span><IconButton icon="close" label="不用" {...keepFocus}
        onClick={onDismiss} /></header>
      <ul>{(suggestion.items ?? []).map((item, index) => <li key={index}>
        <span className="note-suggestion-kind" data-kind={item.kind}>{TYPE_NAMES[item.kind]}</span>
        <span>{item.text}</span><button type="button" className="text-button" {...keepFocus}
          onClick={() => item.kind === 'structure' ? onAdopt(item) : setDraft(item)}>加上</button>
      </li>)}</ul>
      {draft === null ? null : <div className="note-suggestion-draft" role="group" aria-label="补充草稿">
        <span>{draft.draft}</span><button type="button" className="text-button" {...keepFocus}
          onClick={() => onAdopt(draft)}>留下</button>
        <button type="button" className="text-button" {...keepFocus} onClick={() => setDraft(null)}>撤销</button>
      </div>}
    </div>, layout.body);
  }
  return createPortal(<div ref={box} className="note-ghost-line"
    style={{ ...layout.font, ...place, textIndent: layout.indent }}>
    <span className="note-ghost" role="button" aria-label="采用续写" {...keepFocus} onClick={() => onAdopt()}>
      {suggestion.text}</span><kbd className="note-ghost-key">Tab</kbd>
    {/* 手机没有 Tab：灰字下面给一个按钮（11-12 Aaron 看过设计稿定的）。 */}
    <button type="button" className="note-ghost-accept" {...keepFocus} onClick={() => onAdopt()}>收下这句</button>
  </div>, layout.body);
}
