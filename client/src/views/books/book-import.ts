// 导入书：选文件或拖进图书馆页 → 读字节、算 sha256、转 base64 → POST /v2/books。每个文件一行状态：
// 正在导入 / 没导进来（415 / 422 / 413 用服务端那句话）/ 没等到回执（结果待核实，用同一个 requestId 再核实，
// 服务端不会多出一本）。同一个文件再传一次服务端回原来那本，界面直接打开它。

import { useCallback, useRef, useState } from 'react';
import type { BooksApi } from '../../api/books-client.ts';
import { errorText, isUncertain } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import { BOOK_UPLOAD_MAX_BYTES, type BookView } from '../../api/shared.ts';
import { base64Of, readFileBytes } from '../../state/attachment-bytes.ts';

export type ImportRow =
  | { id: string; fileName: string; bytes: number; status: 'uploading' }
  | { id: string; fileName: string; bytes: number; status: 'failed' | 'uncertain'; message: string };

/** 「3.2 MB」「860 KB」：导入那一行右边的大小。 */
export function sizeText(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

async function sha256Of(buffer: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface BookImports {
  rows: ImportRow[];
  importFiles: (files: readonly File[]) => void;
  retry: (id: string) => void;
  dismiss: (id: string) => void;
}

export function useBookImports(api: BooksApi, onImported: (book: BookView, duplicate: boolean) => void): BookImports {
  const [rows, setRows] = useState<ImportRow[]>([]);
  const files = useRef(new Map<string, File>());
  const settled = useRef(onImported);
  settled.current = onImported;
  const replace = (id: string, next: ImportRow | null): void => {
    setRows((current) => next === null ? current.filter((row) => row.id !== id)
      : current.map((row) => (row.id === id ? next : row)));
  };
  const upload = useCallback(async (id: string, file: File): Promise<void> => {
    const base = { id, fileName: file.name, bytes: file.size };
    if (file.size > BOOK_UPLOAD_MAX_BYTES) {
      replace(id, { ...base, status: 'failed', message: '这本书超过 100 MB，导入不了。请换一个小一些的版本。' });
      return;
    }
    replace(id, { ...base, status: 'uploading' });
    try {
      const buffer = await readFileBytes(file);
      const response = await api.upload({ requestId: id, fileName: file.name, bytes: buffer.byteLength,
        sha256: await sha256Of(buffer), content: base64Of(buffer) });
      files.current.delete(id);
      replace(id, null);
      settled.current(response.book, response.duplicate);
    } catch (error) {
      replace(id, { ...base, status: isUncertain(error) ? 'uncertain' : 'failed', message: errorText(error) });
    }
  }, [api]);
  const importFiles = useCallback((picked: readonly File[]): void => {
    for (const file of picked) {
      const id = createRequestId();
      files.current.set(id, file);
      setRows((current) => [...current, { id, fileName: file.name, bytes: file.size, status: 'uploading' }]);
      void upload(id, file);
    }
  }, [upload]);
  const retry = useCallback((id: string): void => {
    const file = files.current.get(id);
    if (file !== undefined) {
      void upload(id, file);
    }
  }, [upload]);
  const dismiss = useCallback((id: string): void => {
    files.current.delete(id);
    replace(id, null);
  }, []);
  return { rows, importFiles, retry, dismiss };
}
