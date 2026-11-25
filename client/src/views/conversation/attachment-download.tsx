import { useEffect, useRef, useState, type ReactNode } from 'react';
import { errorText } from '../../api/errors.ts';
import { saveFile } from '../../shell/save-file.ts';
import type { AttachmentMedia } from './attachment-gallery.tsx';

export function AttachmentDownload({ item }: { item: AttachmentMedia }): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  if (item.loadContent === undefined) return <a href={item.url} download={item.name} className="text-button">下载</a>;
  const download = async (): Promise<void> => {
    const abort = new AbortController();
    pending.current = abort;
    setBusy(true);
    setError(null);
    try {
      const blob = await item.loadContent!(abort.signal);
      if (abort.signal.aborted) return;
      saveFile({ blob, name: item.name });
    } catch (cause) { if (!abort.signal.aborted) setError(errorText(cause)); }
    finally { if (!abort.signal.aborted) setBusy(false); }
  };
  return <span className="attachment-download"><button type="button" className="text-button" disabled={busy}
    onClick={() => void download()}>{busy ? '下载中…' : '下载'}</button>
    {error === null ? null : <span role="alert" className="attachment-download-error">{error}</span>}</span>;
}
