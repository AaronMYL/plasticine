import type { Editor } from '@tiptap/core';
import type { ReactNode } from 'react';
import { SAMPLE_NOTE_CHART } from '../../../../agent/shared/note-chart.ts';
import { DropdownMenu, SEPARATOR, type DropdownEntry, type DropdownItem } from '../../shell/dropdown-menu.tsx';
import { Icon } from '../../shell/icons.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { PHONE_BELOW } from '../../shell/layout.ts';
import { useViewportWidth } from '../../shell/use-viewport-width.ts';

/** 格式菜单里每一项的快捷键（Tiptap StarterKit 的默认键位，Mac 写法）；手机上不写。 */
const FORMAT_KEYS: Readonly<Record<string, string>> = {
  标题: '⌥⌘1', 小标题: '⌥⌘2', 正文: '⌥⌘0', 粗体: '⌘B', 斜体: '⌘I', 删除线: '⇧⌘S', 行内代码: '⌘E',
  列表: '⇧⌘8', 编号: '⇧⌘7', 引用: '⇧⌘B',
};

export function NoteFormat({ editor, upload }: { editor: Editor; upload: () => void }): ReactNode {
  const phone = useViewportWidth() < PHONE_BELOW;
  const formats: [string, () => void][] = [
    ['标题', () => { editor.chain().focus().toggleHeading({ level: 1 }).run(); }],
    ['小标题', () => { editor.chain().focus().toggleHeading({ level: 2 }).run(); }],
    ['正文', () => { editor.chain().focus().setParagraph().run(); }],
    ['粗体', () => { editor.chain().focus().toggleBold().run(); }],
    ['斜体', () => { editor.chain().focus().toggleItalic().run(); }],
    ['删除线', () => { editor.chain().focus().toggleStrike().run(); }],
    ['行内代码', () => { editor.chain().focus().toggleCode().run(); }],
    ['列表', () => { editor.chain().focus().toggleBulletList().run(); }],
    ['编号', () => { editor.chain().focus().toggleOrderedList().run(); }],
    ['引用', () => { editor.chain().focus().toggleBlockquote().run(); }],
    ['分隔线', () => { editor.chain().focus().setHorizontalRule().run(); }],
  ];
  const items: DropdownItem[] = formats.map(([label, run]) => ({
    label, onSelect: run, shortcut: phone ? undefined : FORMAT_KEYS[label],
  }));
  // 段落样式、文字样式、块各成一组，中间一条细线。
  const grouped: DropdownEntry[] = [
    ...items.slice(0, 3), SEPARATOR, ...items.slice(3, 7), SEPARATOR, ...items.slice(7),
  ];
  return <div className="note-toolbar note-format-toolbar">
    <DropdownMenu label="文字格式" className="note-menu-button" items={grouped}>
      格式<Icon name="chevron-down" size={14} />
    </DropdownMenu>
    <IconButton icon="tasks" label="待办" onMouseDown={(event) => event.preventDefault()}
      onClick={() => editor.chain().focus().toggleTaskList().run()} />
    <IconButton icon="table" label="表格" onMouseDown={(event) => event.preventDefault()} onClick={() =>
      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} />
    <IconButton icon="code" label="代码块" onMouseDown={(event) => event.preventDefault()}
      onClick={() => editor.chain().focus().toggleCodeBlock().run()} />
    <IconButton icon="image" label="图片" onMouseDown={(event) => event.preventDefault()} onClick={upload} />
    <IconButton icon="chart" label="图表" onMouseDown={(event) => event.preventDefault()}
      onClick={() => editor.chain().focus().insertContent({
      type: 'codeBlock', attrs: { language: 'chart' },
      content: [{ type: 'text', text: JSON.stringify(SAMPLE_NOTE_CHART, null, 2) }],
    }).run()} />
  </div>;
}
