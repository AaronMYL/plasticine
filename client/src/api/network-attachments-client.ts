import type { ContactMessageView, NetworkAttachmentView, UploadNetworkAttachment } from './shared.ts';

export interface NetworkAttachmentsApi {
  upload(input: UploadNetworkAttachment, signal?: AbortSignal,
    onProgress?: (fraction: number) => void): Promise<NetworkAttachmentView>;
  contentUrl(threadId: string, messageId: string, id: string): string;
  content(threadId: string, messageId: string, id: string, signal?: AbortSignal): Promise<Blob>;
  retry(threadId: string, messageId: string, requestId: string): Promise<ContactMessageView>;
}
