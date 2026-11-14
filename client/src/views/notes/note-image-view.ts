// 笔记里的图（11-14 界面统一，Aaron 定的设计稿「图片」）：整张显示；点一下是选中，选中后图的右上角出「放大」，
// 双击也能开。开的是全局看图（primitives/image-viewer），这篇笔记里的图按顺序都在里面，左右翻。
// 只读的笔记选不中，点一下就开。存回去的 Markdown 不经过这里（editor-extensions.ts 的 renderHTML / renderMarkdown）。

import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorView, NodeView } from '@tiptap/pm/view';
import { currentAssetUrl } from '../../api/shared.ts';
import { showImages, type ViewerImage } from '../../primitives/image-viewer/index.tsx';

function text(node: ProseMirrorNode, name: string): string {
  const value: unknown = node.attrs[name];
  return typeof value === 'string' ? value : '';
}

function shownSrc(node: ProseMirrorNode): string {
  const src = text(node, 'src');
  return src === '' ? '' : currentAssetUrl(src);
}

/** 这篇笔记里所有的图，按出现的顺序；positions 和 images 一一对应。 */
export function noteImages(doc: ProseMirrorNode): { images: ViewerImage[]; positions: number[] } {
  const images: ViewerImage[] = [];
  const positions: number[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'image') { return true; }
    const src = shownSrc(node);
    if (src !== '') {
      const alt = text(node, 'alt');
      images.push(alt === '' ? { src } : { src, alt });
      positions.push(pos);
    }
    return false;
  });
  return { images, positions };
}

function openAt(view: EditorView, pos: number | undefined): void {
  const { images, positions } = noteImages(view.state.doc);
  if (images.length === 0) { return; }
  showImages(images, Math.max(0, pos === undefined ? 0 : positions.indexOf(pos)));
}

function paint(img: HTMLImageElement, node: ProseMirrorNode): void {
  const src = shownSrc(node);
  if (img.getAttribute('src') !== src) { img.setAttribute('src', src); }
  for (const name of ['alt', 'title'] as const) {
    const value = text(node, name);
    if (value === '') { img.removeAttribute(name); } else { img.setAttribute(name, value); }
  }
}

export function noteImageView(first: ProseMirrorNode, view: EditorView, getPos: () => number | undefined): NodeView {
  let node = first;
  const dom = document.createElement('div');
  dom.className = 'note-image';
  const img = document.createElement('img');
  img.draggable = false;
  paint(img, node);
  dom.append(img);
  const zoom = document.createElement('button');
  zoom.type = 'button';
  zoom.className = 'note-image-zoom';
  zoom.textContent = '放大';
  zoom.addEventListener('click', () => openAt(view, getPos()));
  img.addEventListener('dblclick', () => openAt(view, getPos()));
  img.addEventListener('click', () => { if (!view.editable) { openAt(view, getPos()); } });
  return {
    dom,
    update(next) {
      if (next.type !== node.type) { return false; }
      node = next;
      paint(img, node);
      return true;
    },
    selectNode() {
      dom.classList.add('ProseMirror-selectednode');
      dom.append(zoom);
    },
    deselectNode() {
      dom.classList.remove('ProseMirror-selectednode');
      zoom.remove();
    },
    stopEvent: (event) => event.target instanceof Node && zoom.contains(event.target),
    ignoreMutation: (mutation) => mutation.type !== 'selection',
  };
}
