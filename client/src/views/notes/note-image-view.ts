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
  const missing = document.createElement('p');
  missing.className = 'note-image-missing';
  missing.hidden = true;
  img.addEventListener('error', () => {
    missing.textContent = `图片没带进来：${text(node, 'src')}`;
    missing.hidden = false;
    img.hidden = true;
  });
  img.addEventListener('load', () => {
    missing.hidden = true;
    img.hidden = false;
  });
  paint(img, node);
  dom.append(img, missing);
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
