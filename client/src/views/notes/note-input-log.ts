// 输入诊断（11-12 全量优化第 12 条）：拼音没选字就进正文这个问题只在 Mac 客户端 + 第三方输入法、光标在文字中间时出现，
// 模拟组字复现不了。这里把正文上的输入事件和编辑器事务按先后记在内存里（最近 400 条），出问题后从笔记的「⋯」里
// 「复制输入诊断」发给开发。只记事件的种类、长度和位置，不记任何正文内容；不存盘、不上传，关掉这篇笔记就没了。
// 问题查清后连同菜单项一起删掉。

import type { Editor } from '@tiptap/core';

const LIMIT = 400;
const EVENTS = ['compositionstart', 'compositionupdate', 'compositionend', 'beforeinput', 'input', 'keydown',
  'focus', 'blur'] as const;

type Entry = Record<string, string | number | boolean | null>;
const logs = new WeakMap<Editor, Entry[]>();

function shape(text: string | null | undefined): string | null {
  if (text == null) { return null; }
  // 只说是什么样的字：拉丁字母（没选字的拼音）、中文、空白、别的。
  const kind = /^[A-Za-z' ]+$/.test(text) ? '拉丁' : /^\s+$/.test(text) ? '空白' : /[一-鿿]/.test(text) ? '中文' : '其他';
  return `${kind}×${text.length}`;
}

function describe(event: Event): Entry {
  const entry: Entry = { e: event.type };
  if (event instanceof CompositionEvent) { entry['data'] = shape(event.data); }
  if (event instanceof InputEvent) {
    entry['type'] = event.inputType;
    entry['data'] = shape(event.data);
    entry['composing'] = event.isComposing;
  }
  if (event instanceof KeyboardEvent) {
    entry['key'] = event.key.length === 1 ? (/[a-z]/i.test(event.key) ? '字母' : '符号') : event.key;
    entry['code'] = event.keyCode;
    entry['composing'] = event.isComposing;
  }
  return entry;
}

/** 开始记这个编辑器的输入；返回停止。 */
export function recordInput(editor: Editor, dom: HTMLElement): () => void {
  const started = performance.now();
  const log: Entry[] = [];
  logs.set(editor, log);
  const push = (entry: Entry): void => {
    log.push({ t: Math.round(performance.now() - started), ...entry });
    if (log.length > LIMIT) { log.splice(0, log.length - LIMIT); }
  };
  const onEvent = (event: Event): void => push(describe(event));
  const onTransaction = ({ transaction }: { transaction: { docChanged: boolean; selectionSet: boolean;
    steps: readonly unknown[]; getMeta(key: string): unknown } }): void => {
    const { $from, empty } = editor.state.selection;
    push({ e: 'transaction', doc: transaction.docChanged, sel: transaction.selectionSet, steps: transaction.steps.length,
      composition: transaction.getMeta('composition') !== undefined, pmComposing: editor.view.composing,
      at: $from.parentOffset, of: $from.parent.content.size, empty, block: $from.parent.type.name,
      marks: $from.marks().map((mark) => mark.type.name).join('+') });
  };
  for (const name of EVENTS) { dom.addEventListener(name, onEvent, true); }
  editor.on('transaction', onTransaction);
  return () => {
    for (const name of EVENTS) { dom.removeEventListener(name, onEvent, true); }
    editor.off('transaction', onTransaction);
    logs.delete(editor);
  };
}

/** 复制用的文字：环境和最近的事件，一行一条。 */
export function inputDiagnostics(editor: Editor, version: string): string {
  const head = { version, agent: navigator.userAgent, at: new Date().toISOString() };
  return [JSON.stringify(head), ...(logs.get(editor) ?? []).map((entry) => JSON.stringify(entry))].join('\n');
}
