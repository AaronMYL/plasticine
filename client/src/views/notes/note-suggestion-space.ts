// 笔记建议画在 contenteditable 外，正文只给它让出空间：光标所在段落加下边距（装饰），不往正文里插节点，不干扰中文输入法。
// 续写和补充各记各的空间（2026-11-04 用户定：两者可以同时在），同一段落的下边距是原来的边距加两者之和。

import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

export type SuggestionKind = 'predict' | 'interject';
export const SUGGESTION_KINDS: readonly SuggestionKind[] = ['predict', 'interject'];
/** 一条建议要在 position 所在段落下面多留 space；margin 是段落原来的下边距（装饰之前量的）。 */
export interface SuggestionSpace { position: number; space: number; margin: number }
export type SuggestionSpaces = Readonly<Record<SuggestionKind, SuggestionSpace | null>>;
interface SpaceChange { kind: SuggestionKind; value: SuggestionSpace | null }

const spaceKey = new PluginKey<SuggestionSpaces>('noteSuggestionSpace');
const NO_SPACE: SuggestionSpaces = { predict: null, interject: null };

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
  if (editor.isDestroyed || sameSpace(suggestionSpaces(editor.state)[kind], value)) { return; }
  const change: SpaceChange = { kind, value };
  editor.view.dispatch(editor.state.tr.setMeta(spaceKey, change).setMeta('addToHistory', false));
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

/** 正文一改，位置就不作数了：两条建议都会被撤下，空间一起清掉。 */
export function suggestionSpacePlugin(
  handleKeyDown: (view: EditorView, event: KeyboardEvent) => boolean,
): Plugin<SuggestionSpaces> {
  return new Plugin<SuggestionSpaces>({ key: spaceKey,
    state: {
      init: () => NO_SPACE,
      apply(transaction, value) {
        if (transaction.docChanged) { return NO_SPACE; }
        const change: SpaceChange | undefined = transaction.getMeta(spaceKey);
        if (change === undefined) { return value; }
        return { ...value, [change.kind]: change.value };
      },
    },
    props: { decorations, handleKeyDown },
  });
}

export function unregisterSuggestionSpace(editor: Editor): void {
  if (!editor.isDestroyed) { editor.unregisterPlugin(spaceKey); }
}
