// 笔记正文和 Markdown 之间的三件事（11-12 全量优化第 2、3、4 条）：
// - 存：@tiptap/markdown 序列化时把正文里的 & < > 全写成实体（a &gt; b），导出、交给模型、全文搜索看到的都是实体。
//   这里在序列化这一层还原成平常的写法，只在会被当成引用或标签的位置用反斜杠转义；代码块和行内代码原样不动。
// - 复制：剪贴板里纯文本那一份写成 Markdown（HTML 那一份照旧），粘到别处格式还在。
// - 粘贴：纯文本看起来是 Markdown 就按 Markdown 放进来（一次事务，撤销一步回到粘贴前）；光标在代码块里时原样贴。

import { Extension, type JSONContent } from '@tiptap/core';
import { Markdown } from '@tiptap/markdown';
import { Slice, type Node as DocumentNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';

const FENCE = /^\s*(?:>\s*)*(?:[-*+]\s+|\d+[.)]\s+)?(`{3,}|~{3,})/;
/** 这一行里 `>` 之前只有空白、引用和列表记号：这个位置的 `>` 会被当成引用。 */
const BLOCK_START = /^(?:\s|>|[-*+](?=\s)|\d+[.)](?=\s)|\[[ xX]\](?=\s))*$/;
const INLINE_CODE = /(`+)(?:(?!\1)[\s\S])*?\1/g;
const ENTITY = /&(amp|lt|gt);/g;
/** `&` 后面跟着这样的字会被当成实体：这种 `&` 保持写成 &amp;。 */
const ENTITY_TAIL = /^(?:#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/;
/** `<` 后面跟着这样的字会被当成标签、注释或自动链接。 */
const TAG_TAIL = /^[A-Za-z/!?]/;

function decodeOutsideCode(text: string, lineStart: string): string {
  return text.replace(ENTITY, (_match, name: string, offset: number) => {
    const tail = text.slice(offset + _match.length);
    if (name === 'amp') {
      return ENTITY_TAIL.test(tail) ? '&amp;' : '&';
    }
    if (name === 'lt') {
      return TAG_TAIL.test(tail) ? '\\<' : '<';
    }
    return BLOCK_START.test(lineStart + text.slice(0, offset)) ? '\\>' : '>';
  });
}

function decodeLine(line: string): string {
  let out = '';
  let last = 0;
  for (const match of line.matchAll(INLINE_CODE)) {
    out += decodeOutsideCode(line.slice(last, match.index), out) + match[0];
    last = match.index + match[0].length;
  }
  return out + decodeOutsideCode(line.slice(last), out);
}

/** 序列化出来的 Markdown 里把实体还原成平常的字；再读回编辑器是同一份正文。 */
export function readableMarkdown(markdown: string): string {
  if (!markdown.includes('&')) {
    return markdown;
  }
  let fence: string | null = null;
  return markdown.split('\n').map((line) => {
    const marker = FENCE.exec(line)?.[1];
    if (fence !== null) {
      if (marker !== undefined && marker.startsWith(fence)) { fence = null; }
      return line;
    }
    if (marker !== undefined) {
      fence = marker;
      return line;
    }
    return decodeLine(line);
  }).join('\n');
}

/** 和 @tiptap/markdown 一样，只是序列化的结果过一遍 readableMarkdown。 */
export const NoteMarkdown = Markdown.extend({
  onBeforeCreate(event) {
    this.parent?.(event);
    const manager = this.storage.manager;
    const serialize = manager.serialize.bind(manager);
    manager.serialize = (content) => readableMarkdown(serialize(content));
  },
});

const BLOCK_SYNTAX = [
  /^#{1,6}\s+\S/m,
  /^\s*[-*+]\s+\S/m,
  /^\s*\d+[.)]\s+\S/m,
  /^\s*>\s?\S/m,
  /^\s*(?:`{3,}|~{3,})/m,
  /^\s*\|.+\|\s*\n\s*\|?\s*:?-{3,}/m,
  /^(?:-{3,}|\*{3,}|_{3,})\s*$/m,
];
const INLINE_SYNTAX = [/\*\*[^*\n]+\*\*/, /\[[^\]\n]+\]\([^)\s]+\)/, /~~[^~\n]+~~/, /(^|[^`])`[^`\n]+`(?!`)/];

/** 粘进来的纯文本是不是 Markdown：有块级写法（标题、列表、引用、代码块、表格、分隔线）或行内的加粗、链接、删除线、代码。 */
export function looksLikeMarkdown(text: string): boolean {
  return BLOCK_SYNTAX.some((pattern) => pattern.test(text)) || INLINE_SYNTAX.some((pattern) => pattern.test(text));
}

const RICH_TAGS = 'h1,h2,h3,h4,h5,h6,ul,ol,li,blockquote,pre,table,strong,b,em,i,a,img,code,s,del,hr';

/**
 * 剪贴板里的 HTML 只是把同一段纯文本包了一层（代码编辑器、终端复制出来的那种，全是 div / span / br）：
 * 这时以纯文本为准。带标题、列表、加粗这些标签的是真的富文本，交给编辑器照常处理。
 */
export function plainWrapped(html: string): boolean {
  if (html.trim() === '') {
    return true;
  }
  const holder = new DOMParser().parseFromString(html, 'text/html').body;
  return holder.querySelector(RICH_TAGS) === null;
}

/** 这一片是不是只在一个文字块里面（选了一段字，没跨块）：是就返回那个块。 */
function singleTextblock(slice: Slice): DocumentNode | null {
  let node = slice.content.childCount === 1 ? slice.content.firstChild : null;
  for (let depth = 1; node !== null && depth <= Math.min(slice.openStart, slice.openEnd); depth += 1) {
    if (node.isTextblock) {
      return node;
    }
    node = node.childCount === 1 ? node.firstChild : null;
  }
  return null;
}

/** 选中的这一片写成 Markdown。只选了一个文字块里的一段时不带这个块自己的记号（标题的 #、列表的 -）。 */
export function sliceMarkdown(slice: Slice, serialize: (doc: JSONContent) => string): string {
  const block = singleTextblock(slice);
  if (block !== null && block.type.spec.code === true) {
    return block.textContent;
  }
  const content = block === null ? slice.content.toJSON() as JSONContent[]
    : [{ type: 'paragraph', content: block.content.toJSON() as JSONContent[] }];
  return serialize({ type: 'doc', content }).replace(/\n+$/, '');
}

const clipboardKey = new PluginKey('noteMarkdownClipboard');

export const NoteMarkdownClipboard = Extension.create({
  name: 'noteMarkdownClipboard',
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [new Plugin({
      key: clipboardKey,
      props: {
        clipboardTextSerializer: (slice) => {
          const manager = editor.markdown;
          if (manager === undefined) {
            return slice.content.textBetween(0, slice.content.size, '\n\n');
          }
          return sliceMarkdown(slice, (doc) => manager.serialize(doc));
        },
        handlePaste: (view, event) => {
          const data = event.clipboardData;
          const manager = editor.markdown;
          if (data === null || manager === undefined || view.composing) {
            return false;
          }
          // 带文件的（截图、图片）交给图片上传；光标在代码块里时原样贴。
          if (data.files.length > 0 || view.state.selection.$from.parent.type.spec.code === true) {
            return false;
          }
          const text = data.getData('text/plain');
          if (text === '' || !looksLikeMarkdown(text) || !plainWrapped(data.getData('text/html'))) {
            return false;
          }
          const parsed = manager.parse(text.replace(/\r\n?/g, '\n'));
          const doc = view.state.schema.nodeFromJSON(parsed);
          view.dispatch(view.state.tr.replaceSelection(new Slice(doc.content, 0, 0)).scrollIntoView()
            .setMeta('paste', true).setMeta('uiEvent', 'paste'));
          return true;
        },
      },
    })];
  },
});
