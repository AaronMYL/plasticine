import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { errorText } from '../../api/errors.ts';
import { Icon } from '../../shell/icons.tsx';
import type { AttachmentMedia } from './attachment-gallery.tsx';

const Pdf = lazy(() => import('./attachment-pdf.tsx'));

export function AttachmentFilePreview({ item, compact = false }: { item: AttachmentMedia; compact?: boolean }):
  ReactNode {
  const readable = item.mimeType.startsWith('text/') || item.mimeType === 'application/json';
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    setValue(null);
    setError(null);
    if (readable && item.loadContent !== undefined) {
      void item.loadContent(abort.signal).then(async (blob) => {
        const text = await blob.text();
        if (abort.signal.aborted) return;
        setValue(text);
      }).catch((cause: unknown) => {
        if (!abort.signal.aborted) setError(errorText(cause));
      });
    }
    return () => {
      abort.abort();
    };
  }, [item, readable]);
  if (item.mimeType === 'application/pdf') {
    return <Suspense fallback={<Icon name="file" size={24} />}><Pdf item={item} compact={compact} /></Suspense>;
  }
  if (!readable) return compact ? <Icon name="file" size={24} /> : <p>这类文件可以下载后打开。</p>;
  if (error !== null) return compact ? <Icon name="file" size={24} /> : <p role="alert">{error}</p>;
  if (value === null) return compact ? <Icon name="file" size={24} /> : <p role="status">正在读附件…</p>;
  return <pre className="attachment-text-preview">{value}</pre>;
}
