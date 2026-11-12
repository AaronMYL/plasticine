// 中文里直接键入 Markdown（11-12 全量优化第 2 条）。TipTap 自带的规则是按英文写的：加粗、斜体、删除线要求记号前面
// 是行首或空格（「这是**加粗**」不转），代码块只认三个反引号后面的空格，中文输入法下打出来的全角标点一概不认。
// 这里补上：
// - 记号前面是中文（或任何不是字母数字的字）也转：**加粗**、*斜体*、~~删除线~~；
// - 中文输入法下的写法：「》 」引用、「1。 」「1、 」编号、「【】 」待办、「··· 」代码块；
// - 三个反引号（或 ···）后直接回车开代码块。
// 输入法组字期间 TipTap 的输入规则本来就不跑（组完才看），转换是一步事务，撤销一次回到键入的原样。

import { Extension, markInputRule, textblockTypeInputRule, wrappingInputRule, type InputRule } from '@tiptap/core';

/** 记号前面不能是同一个记号、反斜杠；斜体另外不接在字母数字后面（3*4*5 不是斜体）。 */
export const CJK_BOLD = /(?<![*\\])(\*\*(?!\s)([^*\n]+?)(?<!\s)\*\*)$/;
export const CJK_ITALIC = /(?<![*\\A-Za-z0-9])(\*(?![\s*])([^*\n]+?)(?<![\s*])\*)$/;
export const CJK_STRIKE = /(?<![~\\])(~~(?!\s)([^~\n]+?)(?<!\s)~~)$/;
export const FULLWIDTH_QUOTE = /^\s*》\s$/;
export const FULLWIDTH_ORDERED = /^(\d+)[。、．]\s$/;
export const FULLWIDTH_TASK = /^\s*(【\s?([xX])?\s?】)\s$/;
export const FULLWIDTH_CODE = /^···([a-z]+)?[\s\n]$/;
/** 回车时这一行只有代码块的开头记号（可带语言名）。 */
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
