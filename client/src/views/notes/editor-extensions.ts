// 笔记编辑器的 TipTap 扩展（照旧版 NoteEditor 的配置）：正文以 Markdown 存；
// 图片、表格、待办清单的扩展都要在，不然读进来的旧笔记里这些块会在保存时丢掉。
// 迁过来的笔记正文一字不改，图片还指着旧的 /v1/notes/assets/…：只在画出来时换成 /v2/ 的路径（currentAssetUrl），
// 存回去的 Markdown 照旧。

import { mergeAttributes, type AnyExtension } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import { Placeholder } from '@tiptap/extensions';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { cjkMarked } from '../../primitives/message/cjk-marked.ts';
import { NoteCharts } from './note-chart.ts';
import { currentAssetUrl } from '../../api/shared.ts';

const NoteImage = Image.extend({
  renderHTML({ HTMLAttributes }) {
    const src: unknown = HTMLAttributes['src'];
    const shown = typeof src === 'string' ? { src: currentAssetUrl(src) } : {};
    return ['img', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, shown)];
  },
});

export function noteExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
    // 中文标点后的 **…** 认成加粗（和对话同一个解析器）；不然存回去时星号被转义，原文变了。
    Markdown.configure({ marked: cjkMarked }),
    NoteCharts,
    NoteImage.configure({ inline: false, allowBase64: false }),
    TableKit.configure({ table: { resizable: false } }),
    TaskList,
    TaskItem.configure({
      nested: true,
      a11y: { checkboxLabel: (node, checked) => `${checked ? '已完成' : '待办'}：${node.textContent || '空的一项'}` },
    }),
    Placeholder.configure({
      placeholder: ({ pos }) => (pos === 0 ? '标题' : '随便写。'),
    }),
  ];
}
