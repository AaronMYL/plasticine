// 笔记编辑器「是不是正在用输入法组字」只在这里判断（11-12 全量优化第 12 条）。
// 以前三处各判各的：保存器记自己的标记，建议记自己的标记，同步和让位装饰只看 ProseMirror 的 view.composing。
// view.composing 有两种时候不准：5 秒没有新的输入 ProseMirror 会自己把它置回 false（人还在选字）；
// 组字结束后它还会多留一小会儿。所以两个都看：自己按 compositionstart / compositionend 记一份，再加上 view.composing，
// 任何一个说在组字就算在组字。组字期间不许有改正文、改选区、改装饰的事务，也不保存、不换正文。

import { Extension, type Editor } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';

const active = new WeakSet<Editor>();
/** 输入法处理中的按键统一报这个键码。 */
const IME_KEY_CODE = 229;

export function noteComposing(editor: Editor): boolean {
  if (editor.isDestroyed) {
    return false;
  }
  // 视图还没挂上时 editor.view 是 TipTap 的占位代理，读它没有的属性会抛错。
  const view = editor.view;
  return active.has(editor) || ('composing' in view && view.composing === true);
}

/** 在编辑器的 DOM 上记组字的开始和结束；返回取消。失焦时系统会结束组字，有的输入法不补 compositionend，一并算结束。 */
export function trackComposition(editor: Editor, dom: HTMLElement): () => void {
  const start = (): void => { active.add(editor); };
  const end = (): void => { active.delete(editor); };
  // 组字中的按键都带 isComposing（或键码 229）；来了一个不带的，说明组字其实已经结束、只是没收到 compositionend。
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

/**
 * 组字期间不放行空事务（11-12 全量优化第 12 条，根因）。
 * 输入法组字时按退格删掉一个拼音字母，ProseMirror 读到「只删不加」的 DOM 变化，会补发一个退格键问各个键位表要不要接手
 * （prosemirror-view 的 readDOMChange）。TipTap 的命令不管成没成都会发出它那条事务，键位表没接手时发出来的就是空事务；
 * 这时正文还没跟上 DOM，视图一刷新就把正在组的那段字照旧正文重画，输入法的组字被打断，剩下的拼音当成普通字留在正文里。
 * 空事务本身什么都不改，组字期间直接丢掉；随后 ProseMirror 照常把这次删除记进正文。
 */
export const NoteCompositionGuard = Extension.create({
  name: 'noteCompositionGuard',
  // 排在所有扩展前面：别的扩展的 dispatchTransaction 也不该在组字时看到空事务。
  priority: 1000,
  dispatchTransaction({ transaction, next }) {
    if (noteComposing(this.editor) && emptyTransaction(transaction)) {
      return;
    }
    next(transaction);
  },
});

/** 不改正文、不改选区、不改待用格式、不滚动，也没带任何标记的事务。 */
export function emptyTransaction(transaction: Transaction): boolean {
  if (transaction.docChanged || transaction.selectionSet || transaction.storedMarksSet || transaction.scrolledIntoView) {
    return false;
  }
  const meta: unknown = Reflect.get(transaction, 'meta');
  return typeof meta !== 'object' || meta === null || Object.keys(meta).length === 0;
}
