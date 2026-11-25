import {
  ExportNotesRequestSchema,
  ImportNotesRequestSchema,
  TRANSFER_BODY_MAX_BYTES,
  type ImportNotesResponse,
  type TransferFileInput,
} from '../../shared/api/index.ts';
import { DEFAULT_NOTE_FOLDER } from '../../shared/state.ts';
import { exportNotes, importNotes, type TransferFile } from '../transfer/index.ts';
import { ApiError } from './api-error.ts';
import { requireAuth, type Reply, type RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotent } from './idempotency.ts';
import { checkInput } from './validate.ts';
import { noteMetaView } from './views.ts';

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export function transferFiles(files: readonly TransferFileInput[]): TransferFile[] {
  return files.map((file) => {
    if (!BASE64.test(file.contentBase64)) {
      throw new ApiError(400, 'invalid_request', `「${file.name}」的内容不是 base64。`, { field: 'files' });
    }
    return { name: file.name, data: Buffer.from(file.contentBase64, 'base64') };
  });
}

/** POST /v2/notes/import */
export async function importNoteFiles(context: RequestContext): Promise<Reply> {
  const auth = requireAuth(context);
  const raw = await readJsonBody(context.req, TRANSFER_BODY_MAX_BYTES);
  const body = checkInput(ImportNotesRequestSchema, raw, '导入笔记');
  const files = transferFiles(body.files);
  const { state, hub, now } = context.deps;
  return idempotent(context, body.requestId, () => {
    const result = importNotes(state, files, { folder: body.folder ?? DEFAULT_NOTE_FOLDER,
      author: auth.actor === 'system' ? 'ai' : 'user', now });
    for (const note of result.imported) {
      hub.publish({ type: 'note_invalidated', noteId: note.id });
    }
    const response: ImportNotesResponse = { imported: result.imported.map(noteMetaView), skipped: result.skipped };
    return { status: 200, body: response };
  });
}

/** POST /v2/notes/export */
export async function exportNoteFiles(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const body = checkInput(ExportNotesRequestSchema, await readJsonBody(context.req), '导出笔记');
  const file = exportNotes(context.deps.state, body.ids);
  return { status: 200, bytes: { data: file.data, type: file.type, download: file.name } };
}
