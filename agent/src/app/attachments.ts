import { createHash } from 'node:crypto';
import { UploadAttachmentRequestSchema, CONVERSATION_ATTACHMENT_MAX_BYTES } from '../../shared/api/index.ts';
import { extractConversationAttachment } from '../cloud-tools/index.ts';
import { ApiError } from './api-error.ts';
import { param, requireAuth, type Reply, type RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { checkInput } from './validate.ts';

// 当前是单用户库；所有配对设备同属这个用户，owner 不由请求体指定。
export const ATTACHMENT_OWNER = 'library-user';

export async function uploadAttachment(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const body = checkInput(
    UploadAttachmentRequestSchema,
    await readJsonBody(context.req, Math.ceil((CONVERSATION_ATTACHMENT_MAX_BYTES * 4) / 3) + 4096),
    '附件',
  );
  const data = Buffer.from(body.content, 'base64');
  if (data.length !== body.bytes || createHash('sha256').update(data).digest('hex') !== body.sha256) {
    throw new ApiError(400, 'invalid_request', '附件大小或摘要不匹配，请重新选择文件。');
  }
  const store = context.deps.state.attachments;
  const row = store.open(body, ATTACHMENT_OWNER);
  if (row.status === 'ready' || row.status === 'deleted' || row.status === 'deleting') {
    return { status: 201, body: row };
  }
  store.storeBytes(row.id, data);
  let result: { text: string | null; truncated: boolean; error: string | null };
  try {
    result = {
      ...(await extractConversationAttachment(body.mimeType, data, AbortSignal.timeout(20_000))),
      error: null,
    };
  } catch {
    result = {
      text: null,
      truncated: false,
      error: '附件未能读取。请核对文件类型和完整性；扫描版 PDF 需要先转成可选文字。',
    };
  }
  const saved = store.finish(row.id, result);
  context.deps.hub.publish({ type: 'attachment_changed', attachment: saved });
  return { status: 201, body: saved };
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
