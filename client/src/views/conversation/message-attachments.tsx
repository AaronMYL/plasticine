import { useEffect, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { AttachmentGallery, type AttachmentMedia } from './attachment-gallery.tsx';

function LoadedMessageAttachments({ ids }: { ids: readonly string[] }): ReactNode {
  const api = useApi();
  const [items, setItems] = useState<AttachmentMedia[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [retry, setRetry] = useState(0);
  const key = JSON.stringify(ids);
  useEffect(() => {
    const abort = new AbortController();
    setItems([]);
    setErrors([]);
    void Promise.allSettled(ids.map((id) => api.attachments.get(id, abort.signal))).then((results) => {
      if (abort.signal.aborted) return;
      const loaded: AttachmentMedia[] = [];
      const failed: string[] = [];
      for (const result of results) {
        if (result.status === 'rejected') { failed.push(errorText(result.reason)); continue; }
        const row = result.value;
        if (row.status !== 'ready') { failed.push(`${row.name}：${row.error ?? '附件原件暂不可用'}`); continue; }
        loaded.push({ id: row.id, name: row.name, mimeType: row.mimeType, bytes: row.bytes,
          url: api.attachments.contentUrl(row.id), loadContent: (signal) => api.attachments.content(row.id, signal) });
      }
      setItems(loaded);
      setErrors(failed);
    });
    return () => abort.abort();
  }, [api, key, retry]);
  if (ids.length === 0) return null;
  return <>
    <AttachmentGallery items={items} />
    {errors.length === 0 ? null : <p className="is-error text-meta" role="alert">{errors.join('；')}{' '}
      <button type="button" className="text-button" onClick={() => setRetry((value) => value + 1)}>重试读取</button></p>}
  </>;
}

export function MessageAttachments({ ids }: { ids: readonly string[] }): ReactNode {
  return ids.length === 0 ? null : <LoadedMessageAttachments ids={ids} />;
}
