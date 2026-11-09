// 笔记建议画在 contenteditable 外，正文只给它让出空间：光标所在段落加下边距（装饰），不往正文里插节点，不干扰中文输入法。
// 续写和补充各记各的空间（2026-11-04 用户定：两者可以同时在），同一段落的下边距是原来的边距加两者之和。
// 输入法组字期间不改装饰（2026-11-09 他说正在打的字会出现两遍；查到组字一开始就有一个清边距的事务打在正在组的
// 那一段上，疑为原因之一）：组字中要改的空间先记着，组完（flushSuggestionSpace）再改；正文变了空间跟着映射，
// 不在组字的事务里顺手清掉。

import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

export type SuggestionKind = 'predict' | 'interject';
export const SUGGESTION_KINDS: readonly SuggestionKind[] = ['predict', 'interject'];
/** 一条建议要在 position 所在段落下面多留 space；margin 是段落原来的下边距（装饰之前量的）。 */
export interface SuggestionSpace { position: number; space: number; margin: number }
export type SuggestionSpaces = Readonly<Record<SuggestionKind, SuggestionSpace | null>>;
interface SpaceChange { kind: SuggestionKind; value: SuggestionSpace | null }

const spaceKey = new PluginKey<SuggestionSpaces>('noteSuggestionSpace');
const NO_SPACE: SuggestionSpaces = { predict: null, interject: null };
/** 组字期间想改、还没改的空间。 */
const waiting = new WeakMap<Editor, Partial<Record<SuggestionKind, SuggestionSpace | null>>>();

export function suggestionSpaces(state: EditorState): SuggestionSpaces {
  return spaceKey.getState(state) ?? NO_SPACE;
}

/** 段落原来的下边距：已经有建议占着这一段时，量到的边距里含着让出的空，用记下的原值。 */
export function baseMargin(state: EditorState, position: number, measured: number): number {
  const spaces = suggestionSpaces(state);
  const taken = SUGGESTION_KINDS.map((kind) => spaces[kind]).find((value) => value?.position === position);
  return taken?.margin ?? measured;
}

function sameSpace(a: SuggestionSpace | null, b: SuggestionSpace | null): boolean {
  if (a === null || b === null) { return a === b; }
  return a.position === b.position && a.space === b.space && a.margin === b.margin;
}

export function setSuggestionSpace(editor: Editor, kind: SuggestionKind, value: SuggestionSpace | null): void {
  if (editor.isDestroyed) { return; }
  if (editor.view.composing) {
    waiting.set(editor, { ...waiting.get(editor), [kind]: value });
    return;
  }
  if (sameSpace(suggestionSpaces(editor.state)[kind], value)) { return; }
  const change: SpaceChange = { kind, value };
  editor.view.dispatch(editor.state.tr.setMeta(spaceKey, change).setMeta('addToHistory', false));
}

/** 组字结束后补上组字期间记下的改动。 */
export function flushSuggestionSpace(editor: Editor): void {
  const pending = waiting.get(editor);
  waiting.delete(editor);
  for (const kind of SUGGESTION_KINDS) {
    const value = pending?.[kind];
    if (value !== undefined) { setSuggestionSpace(editor, kind, value); }
  }
}

function mapSpace(transaction: Transaction, value: SuggestionSpace | null): SuggestionSpace | null {
  if (value === null) { return null; }
  const mapped = transaction.mapping.mapResult(value.position);
  return mapped.deleted ? null : { ...value, position: mapped.pos };
}

function decorations(state: EditorState): DecorationSet {
  const spaces = suggestionSpaces(state);
  const byPosition = new Map<number, { margin: number; space: number }>();
  for (const kind of SUGGESTION_KINDS) {
    const value = spaces[kind];
    if (value === null || value.space <= 0) { continue; }
    const taken = byPosition.get(value.position);
    byPosition.set(value.position, { margin: taken?.margin ?? value.margin, space: (taken?.space ?? 0) + value.space });
  }
  const found: Decoration[] = [];
  for (const [position, { margin, space }] of byPosition) {
    const resolved = state.doc.resolve(position);
    if (resolved.depth === 0) { continue; }
    found.push(Decoration.node(resolved.before(), resolved.after(), {
      class: 'note-prediction-anchor',
      style: `margin-bottom:${margin + space}px`,
    }));
  }
  return found.length === 0 ? DecorationSet.empty : DecorationSet.create(state.doc, found);
}

/** 正文改了，空间跟着映射到新位置（灰字被照着打的字吃掉时还在同一段）；建议撤下时由界面清掉。 */
export function suggestionSpacePlugin(
  handleKeyDown: (view: EditorView, event: KeyboardEvent) => boolean,
): Plugin<SuggestionSpaces> {
  return new Plugin<SuggestionSpaces>({ key: spaceKey,
    state: {
      init: () => NO_SPACE,
      apply(transaction, value) {
        const mapped = transaction.docChanged
          ? { predict: mapSpace(transaction, value.predict), interject: mapSpace(transaction, value.interject) }
          : value;
        const change: SpaceChange | undefined = transaction.getMeta(spaceKey);
        if (change === undefined) { return mapped; }
        return { ...mapped, [change.kind]: change.value };
      },
    },
    props: { decorations, handleKeyDown },
  });
}

export function unregisterSuggestionSpace(editor: Editor): void {
  if (!editor.isDestroyed) { editor.unregisterPlugin(spaceKey); }
}
