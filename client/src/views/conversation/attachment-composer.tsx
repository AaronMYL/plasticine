import { useRef, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { ATTACHMENT_ACCEPT } from '../../api/shared.ts';
import { Icon } from '../../shell/icons.tsx';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';
import './attachments.css';
import { Sheet } from '../../primitives/sheet/index.tsx';
import { PHONE_BELOW } from '../../shell/layout.ts';
import { useViewportWidth } from '../../shell/use-viewport-width.ts';
import { AttachmentDraftTile } from './attachment-draft-tile.tsx';

export function AttachmentComposer(): ReactNode {
  const api = useApi();
  const { attachments } = useClientState();
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
        accept={ATTACHMENT_ACCEPT}
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
  const { attachments } = useClientState();
  const rows = useStore(attachments.store).filter((row) => !row.canceled);
  const error = useStore(attachments.error);
  return (
    <>
      {error === null ? null : <p role="alert">{error}</p>}
      {rows.length === 0 ? null : (
        <div className="conv-attachments" aria-label="已选附件">
          {rows.map((row) => <AttachmentDraftTile key={row.id} row={row} />)}
        </div>
      )}
    </>
  );
}
