import { useRef, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { ATTACHMENT_ACCEPT } from '../../api/shared.ts';
import { fileSize } from '../../primitives/artifact-card/format.ts';
import { IconButton } from '../../shell/icon-button.tsx';
import { Icon } from '../../shell/icons.tsx';
import type { AttachmentDraft } from '../../state/attachment-drafts.ts';
import { useComposerAttachments } from '../lines/conversation-ui-context.tsx';

const STATUS = { reading: '正在读文件', uploading: '正在上传', ready: '已就绪', failed: '未就绪' } as const;

export function AttachmentDraftTile({ row }: { row: AttachmentDraft }): ReactNode {
  const api = useApi();
  const attachments = useComposerAttachments();
  const input = useRef<HTMLInputElement>(null);
  const image = (row.mimeType ?? row.meta?.mimeType ?? row.remote?.mimeType ?? '').startsWith('image/');
  const preview = attachments.preview(row.id) ?? (image && row.remote !== null
    ? api.attachments.contentUrl(row.remote.id) : null);
  const bytes = row.bytes ?? row.meta?.bytes ?? row.remote?.bytes;
  const loading = row.status === 'reading' || row.status === 'uploading';
  const failed = row.status === 'failed';
  return <div className="conv-attachment-draft" data-image={image} data-failed={failed}>
    {image ? <div className="attachment-draft-image">
      {preview === null ? <Icon name="image" size={24} /> : <img src={preview} alt={`预览 ${row.name}`} />}
    </div> : <>
      <Icon name="file" size={24} />
      <div className="attachment-draft-info"><span>{row.name}</span>
        <span className="text-meta">{bytes === undefined ? STATUS[row.status] : fileSize(bytes)}</span></div>
    </>}
    <span className="sr-only">{STATUS[row.status]}</span>
    {loading ? <div className="attachment-draft-progress" role="progressbar"
      aria-label={`${STATUS[row.status]} ${row.name}`}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((row.progress ?? 0) * 100)}>
      <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
        <circle className="attachment-progress-track" cx="14" cy="14" r="11" fill="none" strokeWidth="2" />
        <circle className="attachment-progress-arc" cx="14" cy="14" r="11" fill="none" strokeWidth="2"
          pathLength="100" strokeDasharray="100" strokeDashoffset={(1 - (row.progress ?? 0)) * 100} />
      </svg>
    </div> : null}
    <div className="attachment-draft-actions">
      <button type="button" onClick={() => input.current?.click()}>替换</button>
      {failed ? <button type="button" aria-label={`重试上传 ${row.name}`}
        onClick={() => void attachments.retry(row.id, api.attachments)}>重试</button> : null}
    </div>
    <input ref={input} type="file" hidden accept={ATTACHMENT_ACCEPT} aria-label={`替换附件 ${row.name}`}
      onChange={(event) => {
        const file = event.target.files?.[0];
        if (file !== undefined) void attachments.replace(row.id, file, api.attachments);
        event.target.value = '';
      }} />
    <IconButton icon="close" className="attachment-draft-remove" label={`移除附件 ${row.name}`}
      onClick={() => attachments.cancel(row.id)} />
    {row.error === null ? null : <span className="attachment-draft-error" role="alert">{row.error}</span>}
  </div>;
}
