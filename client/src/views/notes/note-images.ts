import type { Transaction } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/core';
import { useEffect, useRef, useState } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import { useEditorDom } from './editor-dom.ts';
import { NOTE_IMAGE_MAX_BYTES, NOTE_IMAGE_TYPES, type NoteImageRequest } from '../../api/shared.ts';

interface ImageUpload { file: File; requestId: string }

function readImage(file: File, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const abort = (): void => reader.abort();
    signal.addEventListener('abort', abort, { once: true });
    reader.onload = () => {
      signal.removeEventListener('abort', abort);
      resolve(String(reader.result).split(',')[1] ?? '');
    };
    reader.onerror = () => {
      signal.removeEventListener('abort', abort);
      reject(reader.error);
    };
    reader.onabort = () => {
      signal.removeEventListener('abort', abort);
      reject(new DOMException('已取消', 'AbortError'));
    };
    reader.readAsDataURL(file);
  });
}

export function useNoteImages(editor: Editor | null, noteId: string) {
  const api = useApi();
  const input = useRef<HTMLInputElement>(null);
  const jobs = useRef(new Set<{ controller: AbortController; position: number }>());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const retry = useRef<{ uploads: ImageUpload[]; position: number } | null>(null);
  const run = async (uploads: ImageUpload[], position: number): Promise<void> => {
    if (editor === null || !editor.isEditable) { return; }
    setError(null);
    const job = { controller: new AbortController(), position };
    jobs.current.add(job);
    setBusy(true);
    let index = 0;
    try {
      for (; index < uploads.length; index += 1) {
        const { file, requestId } = uploads[index]!;
        if (!(NOTE_IMAGE_TYPES as readonly string[]).includes(file.type) || file.size > NOTE_IMAGE_MAX_BYTES) {
          throw new Error('请选择不超过 10 MB 的 PNG、JPEG、GIF 或 WebP 图片。');
        }
        const data = await readImage(file, job.controller.signal);
        const saved = await api.notes.uploadImage(noteId, { data, requestId,
          type: file.type as NoteImageRequest['type'] }, job.controller.signal);
        job.controller.signal.throwIfAborted();
        if (editor.isDestroyed) { return; }
        editor.chain().insertContentAt(job.position, {
          type: 'image', attrs: { src: saved.url, alt: file.name },
        }).run();
      }
      retry.current = null;
    } catch (cause) {
      if (!job.controller.signal.aborted) {
        retry.current = { uploads: uploads.slice(index), position: job.position };
        setError(errorText(cause));
      }
    } finally {
      jobs.current.delete(job);
      setBusy(jobs.current.size > 0);
    }
  };
  const upload = (files: File[], position = editor?.state.selection.from ?? 0): Promise<void> =>
    run(files.map((file) => ({ file, requestId: createRequestId() })), position);
  const uploadRef = useRef(upload);
  uploadRef.current = upload;
  const dom = useEditorDom(editor);
  useEffect(() => {
    if (editor === null || dom === null) { return; }
    const paste = (event: ClipboardEvent): void => {
      const files = [...event.clipboardData?.files ?? []].filter((file) => file.type.startsWith('image/'));
      if (files.length > 0) { event.preventDefault(); void uploadRef.current(files); }
    };
    const drop = (event: DragEvent): void => {
      const files = [...event.dataTransfer?.files ?? []].filter((file) => file.type.startsWith('image/'));
      if (files.length === 0) { return; }
      event.preventDefault();
      const position = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
      void uploadRef.current(files, position);
    };
    const mapJobs = ({ transaction }: { transaction: Transaction }): void => {
      if (transaction?.docChanged) {
        for (const job of jobs.current) { job.position = transaction.mapping.map(job.position, 1); }
        if (retry.current !== null) {
          retry.current.position = transaction.mapping.map(retry.current.position, 1);
        }
      }
    };
    dom.addEventListener('paste', paste, true);
    dom.addEventListener('drop', drop, true);
    editor.on('transaction', mapJobs);
    return () => {
      dom.removeEventListener('paste', paste, true);
      dom.removeEventListener('drop', drop, true);
      editor.off('transaction', mapJobs);
      for (const job of jobs.current) { job.controller.abort(); }
    };
  }, [editor, dom]);
  return { input, error, busy, upload,
    cancel: () => {
      for (const job of jobs.current) { job.controller.abort(); }
      setError(null);
    },
    retry: () => {
      const pending = retry.current;
      retry.current = null;
      if (pending !== null) { void run(pending.uploads, pending.position); }
    },
  };
}
