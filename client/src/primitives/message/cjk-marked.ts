// 中日韩友好的强调规则（走查 11-07：「**…。**目前」星号原样露出）。CommonMark 的左右侧定界规则不把中文标点后的
// `**` 算作右侧定界；marked-cjk-friendly（markdown-it-cjk-friendly / remark-cjk-friendly 同一作者的 marked 版）照
// commonmark-spec#650 的提案放宽，加粗、斜体、删除线都管。
// 对话的渲染和笔记编辑器（@tiptap/markdown 不传 marked 时用的就是全局的 marked）共用这一个全局实例：两边读法一致，
// 笔记读进来再存出去不变。模块只求值一次，扩展只装一次。

import { marked } from 'marked';
import markedCjkFriendly from 'marked-cjk-friendly';

marked.use(markedCjkFriendly());

export const cjkMarked = marked;
