import { useRef, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { shownAsImage } from '../../api/shared.ts';
import { IconButton } from '../../shell/icon-button.tsx';
import { Icon } from '../../shell/icons.tsx';
import type { AttachmentDraft } from '../../state/attachment-drafts.ts';
import { useComposerAttachments } from '../lines/conversation-ui-context.tsx';
import { FileExt } from './file-ext.tsx';

const STATUS = { reading: '正在读文件', uploading: '正在上传', ready: '已就绪', failed: '未就绪' } as const;

function percent(row: AttachmentDraft): number {
  return Math.round((row.progress ?? 0) * 100);
}

/** 图：缩略图方块，能替换、重试。 */
function ImageDraft({ row }: { row: AttachmentDraft }): ReactNode {
  const api = useApi();
  const attachments = useComposerAttachments();
  const input = useRef<HTMLInputElement>(null);
  const preview = attachments.preview(row.id) ?? (row.remote !== null ? api.attachments.contentUrl(row.remote.id)
    : null);
  const loading = row.status === 'reading' || row.status === 'uploading';
  const failed = row.status === 'failed';
  return <div className="conv-attachment-draft" data-image="true" data-failed={failed}>
    <div className="attachment-draft-image">
      {preview === null ? <Icon name="image" size={24} /> : <img src={preview} alt={`预览 ${row.name}`} />}
    </div>
    <span className="sr-only">{STATUS[row.status]}</span>
    {loading ? <div className="attachment-draft-progress" role="progressbar"
      aria-label={`${STATUS[row.status]} ${row.name}`}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent(row)}>
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
    <input ref={input} type="file" hidden accept="image/*" aria-label={`替换附件 ${row.name}`}
      onChange={(event) => {
        const file = event.target.files?.[0];
        if (file !== undefined) void attachments.replace(row.id, file, api.attachments);
        event.target.value = '';
      }} />
    <IconButton icon="close" className="attachment-draft-remove" label={`移除附件 ${row.name}`}
      onClick={() => attachments.cancel(row.id)} />
  </div>;
}

/** 别的文件：一枚小条，后缀 + 名字 + ×；传的时候底下一道进度，没传成标红、能重试（原因在输入框上方那一行）。 */
function FileDraft({ row, mime }: { row: AttachmentDraft; mime: string }): ReactNode {
  const api = useApi();
  const attachments = useComposerAttachments();
  const loading = row.status === 'reading' || row.status === 'uploading';
  const failed = row.status === 'failed';
  return <div className="conv-attachment-chip" data-failed={failed}>
    <FileExt name={row.name} mime={mime} small />
    <span className="attachment-chip-name">{row.name}</span>
    <span className="sr-only">{STATUS[row.status]}</span>
    {failed ? <IconButton icon="refresh" size={12} className="attachment-chip-button" label={`重试上传 ${row.name}`}
      title={row.error ?? '重试上传'} onClick={() => void attachments.retry(row.id, api.attachments)} /> : null}
    <IconButton icon="close" size={12} className="attachment-chip-button" label={`移除附件 ${row.name}`}
      onClick={() => attachments.cancel(row.id)} />
    {loading ? <span className="attachment-chip-progress" role="progressbar"
      aria-label={`${STATUS[row.status]} ${row.name}`} aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={percent(row)}>
      <span style={{ transform: `scaleX(${row.progress ?? 0})` }} />
    </span> : null}
  </div>;
}

export function AttachmentDraftTile({ row }: { row: AttachmentDraft }): ReactNode {
  const mime = row.mimeType ?? row.meta?.mimeType ?? row.remote?.mimeType ?? '';
  return shownAsImage(mime) ? <ImageDraft row={row} /> : <FileDraft row={row} mime={mime} />;
}
