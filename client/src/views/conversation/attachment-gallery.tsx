import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { fileSize } from '../../primitives/artifact-card/format.ts';
import { IconButton } from '../../shell/icon-button.tsx';
import { Icon } from '../../shell/icons.tsx';
import { AttachmentFilePreview } from './attachment-file-preview.tsx';
import './attachment-gallery.css';

/** 对话和联系人消息共用；加载原件仍由各自已认证的 API 负责。 */
export interface AttachmentMedia {
  id: string;
  name: string;
  mimeType: string;
  bytes: number;
  url: string;
  loadContent?: (signal: AbortSignal) => Promise<Blob>;
}

const SWIPE_CLOSE_PX = 80;
export function attachmentType(item: AttachmentMedia): string {
  return item.name.split('.').at(-1)?.toUpperCase() ?? item.mimeType;
}

function Preview({ items, initial, onClose }: { items: readonly AttachmentMedia[]; initial: number;
  onClose: () => void }): ReactNode {
  const [index, setIndex] = useState(initial);
  const dialog = useRef<HTMLDialogElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const item = items[index];
  useEffect(() => {
    const node = dialog.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (typeof node?.showModal === 'function') node.showModal();
    else node?.setAttribute('open', '');
    return () => {
      if (typeof node?.close === 'function') node.close();
      opener?.focus();
    };
  }, []);
  if (item === undefined) return null;
  const image = item.mimeType.startsWith('image/');
  return createPortal(<dialog ref={dialog} className="attachment-viewer" aria-label="附件预览" aria-modal="true"
    onCancel={(event) => { event.preventDefault(); onClose(); }} onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key === 'ArrowLeft') setIndex((value) => Math.max(0, value - 1));
      if (event.key === 'ArrowRight') setIndex((value) => Math.min(items.length - 1, value + 1));
    }}>
    <header className="attachment-viewer-head"><span>{item.name}</span>
      <span className="text-meta">{fileSize(item.bytes)}</span>
      <a href={item.url} download={item.name} className="text-button">下载</a>
      <IconButton icon="close" label="关闭预览" onClick={onClose} /></header>
    <div className="attachment-viewer-body" onTouchStart={(event) => {
      const touch = event.touches[0];
      start.current = touch === undefined ? null : { x: touch.clientX, y: touch.clientY };
    }} onTouchEnd={(event) => {
      const touch = event.changedTouches[0];
      if (touch !== undefined && start.current !== null && touch.clientY - start.current.y > SWIPE_CLOSE_PX
        && Math.abs(touch.clientX - start.current.x) < SWIPE_CLOSE_PX) onClose();
      start.current = null;
    }}>
      {image ? <img className="attachment-viewer-image" src={item.url} alt={item.name} draggable={false} />
        : <AttachmentFilePreview item={item} />}
    </div>
    {items.length < 2 ? null : <nav className="attachment-viewer-nav" aria-label="附件切换">
      <IconButton icon="back" label="上一张" disabled={index === 0}
        onClick={() => setIndex((value) => Math.max(0, value - 1))} />
      <span className="text-meta">{index + 1} / {items.length}</span>
      <IconButton icon="chevron-right" label="下一张" disabled={index === items.length - 1}
        onClick={() => setIndex((value) => Math.min(items.length - 1, value + 1))} />
    </nav>}
  </dialog>, document.body);
}

export function AttachmentGallery({ items }: { items: readonly AttachmentMedia[] }): ReactNode {
  const [selected, setSelected] = useState<AttachmentMedia | null>(null);
  const images = items.filter((item) => item.mimeType.startsWith('image/'));
  const files = items.filter((item) => !item.mimeType.startsWith('image/'));
  const previewItems = selected?.mimeType.startsWith('image/') ? images : files;
  if (items.length === 0) return null;
  return <div className="attachment-gallery">
    {images.length === 0 ? null : <div className="attachment-image-grid" data-count={images.length}>
      {images.map((item) => <button key={item.id} type="button" className="attachment-image"
        aria-label={`查看图片 ${item.name}`} onClick={() => setSelected(item)}>
        <img src={item.url} alt={item.name} loading="lazy" /></button>)}
    </div>}
    {files.map((item) => <button key={item.id} type="button" className="attachment-file"
      aria-label={`预览文件 ${item.name}`} onClick={() => setSelected(item)}>
      <span className="attachment-file-thumb" aria-hidden="true">
        {item.mimeType === 'application/pdf' && item.loadContent !== undefined
          ? <AttachmentFilePreview item={item} compact /> : <Icon name="file" size={24} />}
      </span>
      <span className="attachment-file-info"><span>{item.name}</span>
        <span className="text-meta">{attachmentType(item)} · {fileSize(item.bytes)}</span></span>
      <Icon name="external" size={16} />
    </button>)}
    {selected === null ? null : <Preview key={selected.id} items={previewItems}
      initial={Math.max(0, previewItems.findIndex((item) => item.id === selected.id))}
      onClose={() => setSelected(null)} />}
  </div>;
}
