import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { Icon } from '../../shell/icons.tsx';
import { useComposerAttachments } from '../lines/conversation-ui-context.tsx';
import { useStore } from '../../state/use-store.ts';
import './attachments.css';
import { Sheet } from '../../primitives/sheet/index.tsx';
import { PHONE_BELOW } from '../../shell/layout.ts';
import { useViewportWidth } from '../../shell/use-viewport-width.ts';
import { AttachmentDraftTile } from './attachment-draft-tile.tsx';

export function AttachmentComposer(): ReactNode {
  const api = useApi();
  const attachments = useComposerAttachments();
  const input = useRef<HTMLInputElement>(null);
  const photo = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const phone = useViewportWidth() < PHONE_BELOW;
  const [open, setOpen] = useState(false);
  const add = (files: FileList | null): void => {
    setOpen(false);
    void attachments.add(Array.from(files ?? []), api.attachments);
  };
  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        aria-label="选择对话附件"
        onChange={(event) => {
          add(event.target.files);
          event.target.value = '';
        }}
      />
      <input ref={photo} type="file" accept="image/*" multiple hidden aria-label="选择照片"
        onChange={(event) => { add(event.target.files); event.target.value = ''; }} />
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden aria-label="拍照上传"
        onChange={(event) => { add(event.target.files); event.target.value = ''; }} />
      <button
        type="button"
        className="icon-button conv-attach"
        aria-label="添加附件"
        data-tip="添加附件"
        onClick={() => phone ? setOpen(true) : input.current?.click()}
      >
        <Icon name="paperclip" />
      </button>
      <Sheet open={open} title="添加附件" variant="drawer" onClose={() => setOpen(false)}>
        <div className="attachment-source-options">
          <button type="button" className="text-button" onClick={() => photo.current?.click()}>照片</button>
          <button type="button" className="text-button" onClick={() => camera.current?.click()}>拍照</button>
          <button type="button" className="text-button" onClick={() => input.current?.click()}>文件</button>
        </div>
      </Sheet>
    </>
  );
}

export function AttachmentChips(): ReactNode {
  const attachments = useComposerAttachments();
  const rows = useStore(attachments.store).filter((row) => !row.canceled);
  return rows.length === 0 ? null : (
    <div className="conv-attachments" aria-label="已选附件">
      {rows.map((row) => <AttachmentDraftTile key={row.id} row={row} />)}
    </div>
  );
}

/** 提示停这么久自己收；收的动画这么长（和 --motion-base 一致）。 */
export const ATTACHMENT_ERROR_MS = 6000;
const LEAVE_MS = 180;

/**
 * 附件的提示（第13批）：输入框上方一行，写清是哪一份、为什么；带 ×，6 秒后自己收，收了不占地方。重新传成功、
 * 发出去以后也清掉（attachment-drafts）。
 */
export function AttachmentError(): ReactNode {
  const attachments = useComposerAttachments();
  const error = useStore(attachments.error);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    setLeaving(false);
    if (error === null) return undefined;
    const timer = setTimeout(() => setLeaving(true), ATTACHMENT_ERROR_MS);
    return () => clearTimeout(timer);
  }, [error]);
  useEffect(() => {
    if (!leaving || error === null) return undefined;
    const timer = setTimeout(() => {
      if (attachments.error.get() === error) attachments.error.set(null);
    }, LEAVE_MS);
    return () => clearTimeout(timer);
  }, [attachments, error, leaving]);
  if (error === null) return null;
  return <div className="attachment-error" data-leaving={leaving} role="alert">
    <div className="attachment-error-clip">
      <div className="attachment-error-row">
        <span className="attachment-error-text">{error}</span>
        <IconButton icon="close" className="attachment-error-close" label="关掉这条提示"
          onClick={() => setLeaving(true)} />
        <span key={error} className="attachment-error-life" aria-hidden="true" />
      </div>
    </div>
  </div>;
}
