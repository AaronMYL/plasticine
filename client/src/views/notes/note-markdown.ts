import { Extension, type JSONContent } from '@tiptap/core';
import { Markdown } from '@tiptap/markdown';
import { Slice, type Node as DocumentNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';

const FENCE = /^\s*(?:>\s*)*(?:[-*+]\s+|\d+[.)]\s+)?(`{3,}|~{3,})/;
const BLOCK_START = /^(?:\s|>|[-*+](?=\s)|\d+[.)](?=\s)|\[[ xX]\](?=\s))*$/;
const INLINE_CODE = /(`+)(?:(?!\1)[\s\S])*?\1/g;
const ENTITY = /&(amp|lt|gt);/g;
const ENTITY_TAIL = /^(?:#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/;
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

export function looksLikeMarkdown(text: string): boolean {
  return BLOCK_SYNTAX.some((pattern) => pattern.test(text)) || INLINE_SYNTAX.some((pattern) => pattern.test(text));
}

const RICH_TAGS = 'h1,h2,h3,h4,h5,h6,ul,ol,li,blockquote,pre,table,strong,b,em,i,a,img,code,s,del,hr';

export function plainWrapped(html: string): boolean {
  if (html.trim() === '') {
    return true;
  }
  const holder = new DOMParser().parseFromString(html, 'text/html').body;
  return holder.querySelector(RICH_TAGS) === null;
}

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
