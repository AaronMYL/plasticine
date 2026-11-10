import { Type } from 'typebox';
import { RequestIdSchema } from '../../shared/api/common.ts';
import { chatNames, messageView } from './contact-views.ts';
import { groupMessageView } from './group-views.ts';
import { idempotent } from './idempotency.ts';
import { UploadNetworkAttachmentSchema, NETWORK_ATTACHMENT_MAX_BYTES } from '../../shared/network-attachments.ts';
import { attachmentText } from '../network/attachments.ts';
import { ApiError } from './api-error.ts';
import { param, requireAuth, requireUserAuth, type Reply, type RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { checkInput } from './validate.ts';

export async function uploadNetworkAttachment(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const identity = context.deps.state.networkIdentity.get();
  if (identity === undefined) throw new ApiError(409, 'not_joined', '先加入网络再发送附件。');
  const body = checkInput(UploadNetworkAttachmentSchema,
    await readJsonBody(context.req, Math.ceil(NETWORK_ATTACHMENT_MAX_BYTES * 4 / 3) + 30_000), '消息附件');
  const data = Buffer.from(body.content, 'base64');
  const text = await attachmentText(body.mimeType, body.name, data);
  return { status: 201, body: context.deps.state.networkAttachments.upload(body, identity.accountId, text) };
}

export function peerAttachment(context: RequestContext): Reply {
  const envelope = context.deps.network.attachments.serve(param(context, 'attachmentId'),
    context.url.pathname + context.url.search, context.req.headers);
  if (envelope === null) throw new ApiError(403, 'attachment_refused', '不能读取这份附件。');
  return { status: 200, body: envelope, headers: { 'Cache-Control': 'no-store' } };
}

export async function networkAttachmentContent(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const id = param(context, 'attachmentId');
  const view = context.deps.state.networkAttachments.require(id).view;
  const data = await context.deps.network.attachments.content(id, param(context, 'id'), param(context, 'messageId'));
  const inline = ['image/png', 'image/jpeg', 'image/webp'].includes(view.mimeType);
  return { status: 200, bytes: { data, type: inline ? view.mimeType : 'application/octet-stream', noStore: true,
    ...(inline ? {} : { download: view.name }) } };
}

export async function retryNetworkMessage(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const body = checkInput(Type.Object({ requestId: RequestIdSchema }), await readJsonBody(context.req), '重试消息');
  const id = param(context, 'id');
  return idempotent(context, body.requestId, () => {
    const row = context.deps.network.retryMessage(id, param(context, 'messageId'));
    const message = 'authorAccountId' in row ? groupMessageView(context.deps.state, row)
      : messageView(row, chatNames(context.deps.state, id), context.deps.state);
    return { status: 200, body: { message } };
  });
}
