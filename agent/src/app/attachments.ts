import { ATTACHMENT_CHUNK_BYTES, UploadAttachmentMetaSchema } from '../../shared/api/index.ts';
import type { AttachmentView } from '../../shared/attachments.ts';
import { extractConversationAttachment, extractionBytes } from '../cloud-tools/index.ts';
import { StateError } from '../state/index.ts';
import { ApiError } from './api-error.ts';
import { param, requireAuth, type Reply, type RequestContext } from './context.ts';
import { readBinaryBody, readJsonBody } from './http.ts';
import { checkInput } from './validate.ts';

export const ATTACHMENT_OWNER = 'library-user';

const DONE = new Set<AttachmentView['status']>(['ready', 'deleted', 'deleting']);

async function plainly<T>(work: () => T | Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof StateError && error.code === 'invalid_input') {
      throw new ApiError(400, 'invalid_request', error.message);
    }
    throw error;
  }
}

export async function openUpload(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const meta = checkInput(UploadAttachmentMetaSchema, await readJsonBody(context.req, 16 * 1024), '附件');
  const store = context.deps.state.attachments;
  const attachment = store.open(meta, ATTACHMENT_OWNER);
  return { status: 201, body: { attachment, received: store.received(attachment.id) } };
}

export async function uploadChunk(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const store = context.deps.state.attachments;
  const row = store.requireOwned(param(context, 'id'), ATTACHMENT_OWNER);
  const offset = Number(param(context, 'offset'));
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new ApiError(400, 'invalid_request', '分块的位置不对。');
  }
  const data = await readBinaryBody(context.req, ATTACHMENT_CHUNK_BYTES);
  return { status: 200, body: { received: await plainly(() => store.appendChunk(row.id, offset, data)) } };
}

export async function completeUpload(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const store = context.deps.state.attachments;
  const row = store.requireOwned(param(context, 'id'), ATTACHMENT_OWNER);
  if (DONE.has(row.status)) {
    return { status: 200, body: row };
  }
  await plainly(() => store.completeUpload(row.id));
  let result: { text: string | null; truncated: boolean; error: string | null };
  const limit = extractionBytes(row.mimeType, row.bytes);
  try {
    result = limit === 0 ? { text: null, truncated: false, error: null } : {
      ...(await extractConversationAttachment(row.mimeType, store.readStored(row.id, limit),
        AbortSignal.timeout(20_000))),
      error: null,
    };
  } catch {
    result = { text: null, truncated: false, error: '这张图打不开：文件内容和图片格式对不上，请换一张。' };
  }
  const saved = store.finish(row.id, result);
  context.deps.hub.publish({ type: 'attachment_changed', attachment: saved });
  return { status: 200, body: saved };
}

export function lookupAttachment(context: RequestContext): Reply {
  requireAuth(context);
  const store = context.deps.state.attachments;
  const row = store.findUpload(param(context, 'requestId'));
  return { status: 200, body: row === null ? null : store.requireOwned(row.id, ATTACHMENT_OWNER) };
}

export function getAttachment(context: RequestContext): Reply {
  requireAuth(context);
  return { status: 200, body: context.deps.state.attachments.requireOwned(param(context, 'id'), ATTACHMENT_OWNER) };
}

export function getAttachmentText(context: RequestContext): Reply {
  requireAuth(context);
  const store = context.deps.state.attachments;
  const row = store.requireOwned(param(context, 'id'), ATTACHMENT_OWNER);
  const text = store.text(row.id);
  return { status: 200, body: {
    text, characters: text === null ? 0 : Array.from(text).length, truncated: row.truncated,
  } };
}

export function getAttachmentContent(context: RequestContext): Reply {
  requireAuth(context);
  const store = context.deps.state.attachments;
  const row = store.requireOwned(param(context, 'id'), ATTACHMENT_OWNER);
  if (row.status === 'deleted' || row.status === 'deleting') {
    throw new ApiError(410, 'attachment_deleted', '原图已按记账确认删除，只保留摘要。');
  }
  return {
    status: 200,
    bytes: {
      data: store.readBytes(row.id),
      type: row.mimeType,
      noStore: true,
      ...(row.mimeType.startsWith('image/') ? {} : { download: row.name }),
    },
  };
}
