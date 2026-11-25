import { Extension, type Editor } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';

const active = new WeakSet<Editor>();
const IME_KEY_CODE = 229;

export function noteComposing(editor: Editor): boolean {
  if (editor.isDestroyed) {
    return false;
  }
  const view = editor.view;
  return active.has(editor) || ('composing' in view && view.composing === true);
}

export function trackComposition(editor: Editor, dom: HTMLElement): () => void {
  const start = (): void => { active.add(editor); };
  const end = (): void => { active.delete(editor); };
  const key = (event: KeyboardEvent): void => {
    if (!event.isComposing && event.keyCode !== IME_KEY_CODE) { end(); }
  };
  dom.addEventListener('compositionstart', start);
  dom.addEventListener('compositionend', end);
  dom.addEventListener('blur', end);
  dom.addEventListener('keydown', key);
  return () => {
    dom.removeEventListener('compositionstart', start);
    dom.removeEventListener('compositionend', end);
    dom.removeEventListener('blur', end);
    dom.removeEventListener('keydown', key);
    active.delete(editor);
  };
}

export const NoteCompositionGuard = Extension.create({
  name: 'noteCompositionGuard',
  priority: 1000,
  dispatchTransaction({ transaction, next }) {
    if (noteComposing(this.editor) && emptyTransaction(transaction)) {
      return;
    }
    next(transaction);
  },
});

export function emptyTransaction(transaction: Transaction): boolean {
  if (transaction.docChanged || transaction.selectionSet || transaction.storedMarksSet
    || transaction.scrolledIntoView) {
    return false;
  }
  const meta: unknown = Reflect.get(transaction, 'meta');
  return typeof meta !== 'object' || meta === null || Object.keys(meta).length === 0;
}
