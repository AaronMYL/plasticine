import { Extension, markInputRule, textblockTypeInputRule, wrappingInputRule, type InputRule } from '@tiptap/core';

export const CJK_BOLD = /(?<![*\\])(\*\*(?!\s)([^*\n]+?)(?<!\s)\*\*)$/;
export const CJK_ITALIC = /(?<![*\\A-Za-z0-9])(\*(?![\s*])([^*\n]+?)(?<![\s*])\*)$/;
export const CJK_STRIKE = /(?<![~\\])(~~(?!\s)([^~\n]+?)(?<!\s)~~)$/;
export const FULLWIDTH_QUOTE = /^\s*》\s$/;
export const FULLWIDTH_ORDERED = /^(\d+)[。、．]\s$/;
export const FULLWIDTH_TASK = /^\s*(【\s?([xX])?\s?】)\s$/;
export const FULLWIDTH_CODE = /^···([a-z]+)?[\s\n]$/;
const FENCE_LINE = /^(?:```|~~~|···)([A-Za-z0-9+#-]*)$/;

export const NoteInputRules = Extension.create({
  name: 'noteInputRules',
  addInputRules() {
    const { marks, nodes } = this.editor.schema;
    const rules: InputRule[] = [];
    const bold = marks['bold'];
    const italic = marks['italic'];
    const strike = marks['strike'];
    if (bold !== undefined) { rules.push(markInputRule({ find: CJK_BOLD, type: bold })); }
    if (italic !== undefined) { rules.push(markInputRule({ find: CJK_ITALIC, type: italic })); }
    if (strike !== undefined) { rules.push(markInputRule({ find: CJK_STRIKE, type: strike })); }
    const blockquote = nodes['blockquote'];
    const orderedList = nodes['orderedList'];
    const taskItem = nodes['taskItem'];
    const codeBlock = nodes['codeBlock'];
    if (blockquote !== undefined) { rules.push(wrappingInputRule({ find: FULLWIDTH_QUOTE, type: blockquote })); }
    if (orderedList !== undefined) {
      rules.push(wrappingInputRule({ find: FULLWIDTH_ORDERED, type: orderedList,
        getAttributes: (match) => ({ start: Number(match[1]) }),
        joinPredicate: (match, node) => node.childCount + Number(node.attrs['start']) === Number(match[1]) }));
    }
    if (taskItem !== undefined) {
      rules.push(wrappingInputRule({ find: FULLWIDTH_TASK, type: taskItem,
        getAttributes: (match) => ({ checked: match[2] !== undefined }) }));
    }
    if (codeBlock !== undefined) {
      rules.push(textblockTypeInputRule({ find: FULLWIDTH_CODE, type: codeBlock,
        getAttributes: (match) => ({ language: match[1] }) }));
    }
    return rules;
  },
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { selection } = editor.state;
        const { $from } = selection;
        if (editor.view.composing || !selection.empty || $from.parent.type.name !== 'paragraph'
          || $from.parentOffset !== $from.parent.content.size) {
          return false;
        }
        const fence = FENCE_LINE.exec($from.parent.textContent);
        if (fence === null) {
          return false;
        }
        const language = fence[1] === '' ? null : fence[1]?.toLowerCase() ?? null;
        return editor.chain().deleteRange({ from: $from.start(), to: $from.end() })
          .setNode('codeBlock', { language }).run();
      },
    };
  },
});
