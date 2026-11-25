import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { ImageContent, Model, Api, UserMessage } from '@earendil-works/pi-ai';
import { errorCategory, safeLog } from '../util/index.ts';
import type { StateService } from '../state/index.ts';
import { attachmentIds } from './messages.ts';

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export type ImagesOf = (ids: readonly string[]) => ImageContent[];
const MODEL_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export function seesImages(model: Model<Api>): boolean {
  return model.input.includes('image');
}

export function withImages(messages: AgentMessage[], imagesOf: ImagesOf, seqOf: WeakMap<object, number>)
  : AgentMessage[] {
  return messages.map((message) => {
    if (message.role !== 'user' || typeof message.content === 'string') {
      return message;
    }
    const images = imagesOf(attachmentIds(message as UserMessage));
    if (images.length === 0) {
      return message;
    }
    const next: UserMessage = { ...message, content: [...message.content, ...images] };
    const seq = seqOf.get(message);
    if (seq !== undefined) {
      seqOf.set(next, seq);
    }
    return next;
  });
}

export function imagesOf(state: Pick<StateService, 'attachments'>, ids: readonly string[]): ImageContent[] {
  return ids.flatMap((id) => {
    const attachment = state.attachments.get(id);
    if (attachment === null || attachment.status !== 'ready' || !MODEL_IMAGE_TYPES.has(attachment.mimeType)
      || attachment.bytes > IMAGE_MAX_BYTES) {
      return [];
    }
    try {
      return [{ type: 'image' as const, data: state.attachments.readBytes(id).toString('base64'),
        mimeType: attachment.mimeType }];
    } catch (error) {
      safeLog('warn', 'line_image_unreadable', { category: errorCategory(error) });
      return [];
    }
  });
}

export function withContextImages(messages: AgentMessage[], images: readonly ImageContent[], vision: boolean,
  seqOf: WeakMap<object, number>): AgentMessage[] {
  if (images.length === 0) return messages;
  const index = messages.findLastIndex((message) => message.role === 'user');
  const current = messages[index];
  if (current?.role !== 'user') return messages;
  const content = typeof current.content === 'string' ? [{ type: 'text' as const, text: current.content }]
    : current.content;
  const next: UserMessage = { ...current, content: [...content, ...(vision ? images : [
    { type: 'text' as const, text: '图片读取状态：当前模型未收到图片输入。' },
  ])] };
  const seq = seqOf.get(current);
  if (seq !== undefined) seqOf.set(next, seq);
  return messages.map((message, position) => position === index ? next : message);
}
