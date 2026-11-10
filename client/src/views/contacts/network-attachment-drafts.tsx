import { useMemo, type ReactNode } from 'react';
import type { NetworkAttachmentsApi } from '../../api/network-attachments-client.ts';
import { Store } from '../../state/store.ts';
import { useStore } from '../../state/use-store.ts';
import { useApi } from '../../api/context.tsx';
import type { NetworkAttachmentView, UploadNetworkAttachment } from '../../api/shared.ts';
import { NETWORK_ATTACHMENT_MAX_BYTES } from '../../api/shared.ts';
import { createRequestId } from '../../api/request-id.ts';
import { errorText } from '../../api/errors.ts';
import { base64Of, readFileBytes } from '../../state/attachment-bytes.ts';
import { Icon } from '../../shell/icons.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { fileSize } from '../../primitives/artifact-card/format.ts';
import '../conversation/attachments.css';

interface Draft {
  id: string; file: File; preview: string | null; progress: number; loading: boolean; error: string | null;
  remote: NetworkAttachmentView | null; payload: UploadNetworkAttachment | null;
}
async function thumbnail(file: File): Promise<Partial<UploadNetworkAttachment>> {
  if (!file.type.startsWith('image/') || typeof createImageBitmap !== 'function') return {};
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (context === null) return {};
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.72, 0.45, 0.2]) {
      const data = canvas.toDataURL('image/jpeg', quality).split(',')[1];
      if (data !== undefined && data.length <= 16_000) {
        return { width: bitmap.width, height: bitmap.height, thumbnail: { mimeType: 'image/jpeg',
          width: canvas.width, height: canvas.height,
          content: data.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '') } };
      }
    }
    for (let shrink = 0; shrink < 3; shrink++) {
      canvas.width = Math.max(1, Math.round(canvas.width / 2));
      canvas.height = Math.max(1, Math.round(canvas.height / 2));
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL('image/jpeg', 0.4).split(',')[1];
      if (data !== undefined && data.length <= 16_000) return { width: bitmap.width, height: bitmap.height,
        thumbnail: { mimeType: 'image/jpeg', width: canvas.width, height: canvas.height,
          content: data.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '') } };
    }
    return { width: bitmap.width, height: bitmap.height };
  } finally { bitmap.close(); }
}

function createDrafts(api: NetworkAttachmentsApi) {
  const store = new Store<{ rows: Draft[]; error: string | null }>({ rows: [], error: null });
  const pending = new Map<string, AbortController>();
  const patch = (id: string, change: Partial<Draft>): void => store.set((data) => ({ ...data,
    rows: data.rows.map((row) => row.id === id ? { ...row, ...change } : row) }));
  const remove = (id: string): void => {
    pending.get(id)?.abort(); pending.delete(id);
    const row = store.get().rows.find((item) => item.id === id);
    if (row?.preview != null) URL.revokeObjectURL(row.preview);
    store.set((data) => ({ ...data, rows: data.rows.filter((item) => item.id !== id) }));
  };
  const upload = async (row: Draft): Promise<void> => {
    const abort = new AbortController(); pending.set(row.id, abort);
    patch(row.id, { loading: true, error: null, progress: 0 });
    try {
      let payload = row.payload;
      if (payload === null) {
        const buffer = await readFileBytes(row.file);
        const digest = await crypto.subtle.digest('SHA-256', buffer);
        payload = { requestId: row.id, name: row.file.name,
          mimeType: row.file.type || 'application/octet-stream', bytes: row.file.size,
          sha256: [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join(''),
          content: base64Of(buffer), ...await thumbnail(row.file) };
        patch(row.id, { payload });
      }
      abort.signal.throwIfAborted();
      const remote = await api.upload(payload, abort.signal,
        (progress) => { if (!abort.signal.aborted) patch(row.id, { progress }); });
      if (!abort.signal.aborted) patch(row.id, { loading: false, progress: 1, remote });
    } catch (cause) {
      if (!abort.signal.aborted) patch(row.id, { loading: false, error: errorText(cause) });
    } finally { if (pending.get(row.id) === abort) pending.delete(row.id); }
  };
  return { store, remove,
    clear(): void { for (const row of store.get().rows) remove(row.id); },
    retry(id: string): void {
      const row = store.get().rows.find((item) => item.id === id);
      if (row !== undefined) void upload(row);
    },
    add(files: File[], replace?: string): void {
      const rows = store.get().rows;
      const replaceAt = replace === undefined ? -1 : rows.findIndex((row) => row.id === replace);
      if (replace !== undefined && replaceAt === -1) return;
      if (rows.length + files.length - Number(replaceAt !== -1) > 5) {
        store.set((data) => ({ ...data, error: '一条消息最多五份附件。' })); return;
      }
      if (files.some((file) => file.size === 0 || file.size > NETWORK_ATTACHMENT_MAX_BYTES)) {
        store.set((data) => ({ ...data, error: '每份附件最多 25 MB，空文件不能发送。' })); return;
      }
      if (replace !== undefined) remove(replace);
      const added: Draft[] = files.map((file) => ({ id: createRequestId(), file,
        preview: typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null,
        progress: 0, loading: true, error: null, remote: null, payload: null }));
      store.set((data) => {
        const next = [...data.rows]; next.splice(replaceAt === -1 ? next.length : replaceAt, 0, ...added);
        return { rows: next, error: null };
      });
      for (const row of added) void upload(row);
    },
  };
}
const draftsByApi = new WeakMap<NetworkAttachmentsApi, Map<string, ReturnType<typeof createDrafts>>>();

/** 待发文件按对话保存；切到另一位联系人时不串附件，也不丢掉正在上传的文件。 */
export function useNetworkAttachmentDrafts(threadId: string) {
  const { networkAttachments: api } = useApi();
  const drafts = useMemo(() => {
    let threads = draftsByApi.get(api);
    if (threads === undefined) { threads = new Map(); draftsByApi.set(api, threads); }
    let row = threads.get(threadId);
    if (row === undefined) { row = createDrafts(api); threads.set(threadId, row); }
    return row;
  }, [api, threadId]);
  const { rows, error } = useStore(drafts.store);
  return { rows, error, add: drafts.add, remove: drafts.remove, clear: drafts.clear, retry: drafts.retry,
    ready: rows.every((row) => row.remote !== null && !row.loading && row.error === null),
    ids: rows.flatMap((row) => row.remote === null ? [] : [row.remote.id]) };
}

export function NetworkAttachmentDrafts({ drafts, disabled }: {
  drafts: ReturnType<typeof useNetworkAttachmentDrafts>; disabled: boolean;
}): ReactNode {
  return <>{drafts.rows.length === 0 ? null : <div className="conv-attachments contact-attachment-drafts">
    {drafts.rows.map((row) => <div className="conv-attachment-draft" key={row.id}
      data-image={row.file.type.startsWith('image/')} data-failed={row.error !== null}>
      {row.file.type.startsWith('image/') && row.preview !== null
        ? <div className="attachment-draft-image"><img src={row.preview} alt={`预览 ${row.file.name}`} /></div>
        : <><Icon name="file" size={24} /><span className="attachment-draft-info"><span>{row.file.name}</span>
          <span className="text-meta">{fileSize(row.file.size)}</span></span></>}
      {row.loading ? <div className="attachment-draft-progress" role="progressbar" aria-label={`上传 ${row.file.name}`}
        aria-valuenow={Math.round(row.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
        <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
          <circle className="attachment-progress-track" cx="14" cy="14" r="11" fill="none" strokeWidth="2" />
          <circle className="attachment-progress-arc" cx="14" cy="14" r="11" fill="none" strokeWidth="2"
            pathLength="100" strokeDasharray="100" strokeDashoffset={(1 - row.progress) * 100} /></svg></div> : null}
      <div className="attachment-draft-actions">
        <label className="contact-attachment-replace">替换<input type="file" hidden disabled={disabled}
          aria-label={`替换附件 ${row.file.name}`} onChange={(event) => {
            const file = event.target.files?.[0]; if (file !== undefined) drafts.add([file], row.id);
          }} /></label>
        {row.error === null ? null : <button type="button" disabled={disabled} onClick={() => drafts.retry(row.id)}
          aria-label={`重试上传 ${row.file.name}`}>重试</button>}</div>
      <IconButton icon="close" className="attachment-draft-remove" label={`移除附件 ${row.file.name}`}
        disabled={disabled} onClick={() => drafts.remove(row.id)} />
      {row.error === null ? null : <span className="attachment-draft-error" role="alert">{row.error}</span>}
    </div>)}</div>}
    {drafts.error === null ? null : <p className="contact-media-error" role="alert">{drafts.error}</p>}
  </>;
}
