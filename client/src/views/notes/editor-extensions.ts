import { mergeAttributes, type AnyExtension } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import { Placeholder } from '@tiptap/extensions';
import StarterKit from '@tiptap/starter-kit';
import { cjkMarked } from '../../primitives/message/cjk-marked.ts';
import { NoteCharts } from './note-chart.ts';
import { NoteCompositionGuard } from './note-composition.ts';
import { NoteInputRules } from './note-input-rules.ts';
import { NoteMarkdown, NoteMarkdownClipboard } from './note-markdown.ts';
import { currentAssetUrl } from '../../api/shared.ts';
import { noteImageView } from './note-image-view.ts';

const NoteImage = Image.extend({
  renderHTML({ HTMLAttributes }) {
    const src: unknown = HTMLAttributes['src'];
    const shown = typeof src === 'string' ? { src: currentAssetUrl(src) } : {};
    return ['img', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, shown)];
  },
  addNodeView() { return ({ node, view, getPos }) => noteImageView(node, view, getPos); },
});

export function noteExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
    NoteMarkdown.configure({ marked: cjkMarked }),
    NoteMarkdownClipboard,
    NoteCompositionGuard,
    NoteInputRules,
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
