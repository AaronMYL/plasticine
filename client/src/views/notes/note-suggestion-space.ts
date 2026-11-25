import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { noteComposing } from './note-composition.ts';

export type SuggestionKind = 'predict' | 'interject';
export const SUGGESTION_KINDS: readonly SuggestionKind[] = ['predict', 'interject'];
export interface SuggestionSpace { position: number; space: number; margin: number }
export type SuggestionSpaces = Readonly<Record<SuggestionKind, SuggestionSpace | null>>;
interface SpaceChange { kind: SuggestionKind; value: SuggestionSpace | null }

const spaceKey = new PluginKey<SuggestionSpaces>('noteSuggestionSpace');
const NO_SPACE: SuggestionSpaces = { predict: null, interject: null };
const waiting = new WeakMap<Editor, Partial<Record<SuggestionKind, SuggestionSpace | null>>>();

export function suggestionSpaces(state: EditorState): SuggestionSpaces {
  return spaceKey.getState(state) ?? NO_SPACE;
}

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
  if (noteComposing(editor)) {
    waiting.set(editor, { ...waiting.get(editor), [kind]: value });
    return;
  }
  if (sameSpace(suggestionSpaces(editor.state)[kind], value)) { return; }
  const change: SpaceChange = { kind, value };
  editor.view.dispatch(editor.state.tr.setMeta(spaceKey, change).setMeta('addToHistory', false));
}

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
