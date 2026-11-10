import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnnotationMode, GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { IconButton } from '../../shell/icon-button.tsx';
import type { AttachmentMedia } from './attachment-gallery.tsx';
import { LocalPdfResources } from './pdf-resources.ts';

GlobalWorkerOptions.workerSrc = workerUrl;
const LOAD_TIMEOUT_MS = 15_000;
const CANVAS_MAX_BYTES = 64 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 16 * 1024 * 1024;
const MAX_RENDER_HEIGHT = 1800;

export default function AttachmentPdf({ item, compact = false }: { item: AttachmentMedia; compact?: boolean }):
  ReactNode {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    let loading: ReturnType<typeof getDocument> | null = null;
    setDocument(null);
    setPage(1);
    setError(null);
    const timer = setTimeout(() => {
      abort.abort();
      void loading?.destroy();
      setError('PDF 预览超时，请下载原件查看。');
    }, LOAD_TIMEOUT_MS);
    void item.loadContent?.(abort.signal).then(async (blob) => {
      const data = new Uint8Array(await blob.arrayBuffer());
      if (abort.signal.aborted) return;
      // 只渲染画布，不创建注释/表单/脚本执行层；文档字节已由认证接口取回。
      loading = getDocument({ data, verbosity: 0, useWorkerFetch: false, disableFontFace: true,
        disableAutoFetch: true, disableStream: true, enableXfa: false, stopAtErrors: true,
        maxImageSize: MAX_IMAGE_PIXELS, canvasMaxAreaInBytes: CANVAS_MAX_BYTES, BinaryDataFactory: LocalPdfResources });
      const pdf = await loading.promise;
      if (!abort.signal.aborted) setDocument(pdf);
    }).catch(() => {
      if (!abort.signal.aborted) setError('PDF 暂时无法预览，请下载原件查看。');
    }).finally(() => clearTimeout(timer));
    return () => {
      abort.abort();
      clearTimeout(timer);
      void loading?.destroy();
    };
  }, [item]);

  useEffect(() => {
    const node = canvas.current;
    if (document === null || node === null) return undefined;
    let active = true;
    let render: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined;
    void document.getPage(page).then(async (pdfPage) => {
      if (!active) return;
      const base = pdfPage.getViewport({ scale: 1 });
      const width = compact ? 96 : Math.min(1000, node.parentElement?.clientWidth ?? 800);
      const scale = Math.min(width * Math.min(devicePixelRatio, 2) / base.width, MAX_RENDER_HEIGHT / base.height);
      const viewport = pdfPage.getViewport({ scale });
      node.width = Math.ceil(viewport.width);
      node.height = Math.ceil(viewport.height);
      render = pdfPage.render({ canvas: node, viewport, annotationMode: AnnotationMode.DISABLE });
      await render.promise;
    }).catch(() => {
      if (active) setError('这一页暂时无法预览，请下载原件查看。');
    });
    return () => { active = false; render?.cancel(); };
  }, [document, page, compact]);

  if (error !== null) return compact ? <span className="text-meta">PDF</span> : <p role="alert">{error}</p>;
  return <div className={compact ? 'attachment-pdf-compact' : 'attachment-pdf-pages'}>
    <canvas ref={canvas} aria-label={`${item.name}第 ${page} 页`} role="img" />
    {compact || document === null || document.numPages < 2 ? null : <nav aria-label="PDF 翻页">
      <IconButton icon="back" label="上一页" disabled={page === 1} onClick={() => setPage((value) => value - 1)} />
      <span className="text-meta">{page} / {document.numPages}</span>
      <IconButton icon="chevron-right" label="下一页" disabled={page === document.numPages}
        onClick={() => setPage((value) => value + 1)} />
    </nav>}
  </div>;
}
