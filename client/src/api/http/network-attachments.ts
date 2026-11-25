import type { NetworkAttachmentsApi } from '../network-attachments-client.ts';
import { NETWORK_ATTACHMENTS_PATH, NetworkAttachmentViewSchema, SendContactMessageResponseSchema } from '../shared.ts';
import type { Transport } from './transport.ts';
const messagePath = (thread: string, message: string): string =>
  `/v2/contacts/${encodeURIComponent(thread)}/messages/${encodeURIComponent(message)}`;
export function createNetworkAttachmentsHttp(transport: Transport): NetworkAttachmentsApi {
  const url = (thread: string, message: string, id: string): string =>
    `${messagePath(thread, message)}/attachments/${encodeURIComponent(id)}/content`;
  return {
    upload: (input, signal, onProgress) => transport.request({ method: 'POST', path: NETWORK_ATTACHMENTS_PATH,
      body: input, signal, schema: NetworkAttachmentViewSchema, what: '上传消息附件', lostAs: 'uncertain',
      timeoutMs: 90_000, ...(onProgress === undefined ? {} : { onUploadProgress: onProgress }) }),
    contentUrl: url,
    content: (thread, message, id, signal) => transport.blob(url(thread, message, id), signal),
    retry: async (thread, message, requestId) => (await transport.request({ method: 'POST',
      path: `${messagePath(thread, message)}/retry`, body: { requestId }, schema: SendContactMessageResponseSchema,
      what: '重试发送', lostAs: 'uncertain' })).message,
  };
}
