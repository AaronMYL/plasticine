// 图片附件送给能看图的模型（2026-11-05）：库里存的用户消息只记附件的名字和 id（不存图，库不跟着变大），每次装上下文时，
// 模型的 input 带 image 才按 id 读出图，作为图片段接在那句话后面；不能看图的模型照旧只看到附件说明
// （正文用 attachment_text 读）。

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { ImageContent, Model, Api, UserMessage } from '@earendil-works/pi-ai';
import { errorCategory, safeLog } from '../shared-log.ts';
import type { StateService } from '../state/index.ts';
import { attachmentIds } from './messages.ts';

// 一张图最多带这么大（更大的模型多半也收不下，附件说明照旧在）。
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export type ImagesOf = (ids: readonly string[]) => ImageContent[];

export function seesImages(model: Model<Api>): boolean {
  return model.input.includes('image');
}

/** 带附件的用户消息换成带图的新对象（原对象不动，压缩用的 seq 对照跟到新对象上）。 */
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

/** 按 id 读出就绪的图片附件（png / jpeg / webp，不超过 IMAGE_MAX_BYTES）；读不到的跳过，附件说明还在。 */
export function imagesOf(state: Pick<StateService, 'attachments'>, ids: readonly string[]): ImageContent[] {
  return ids.flatMap((id) => {
    const attachment = state.attachments.get(id);
    if (attachment === null || attachment.status !== 'ready' || !attachment.mimeType.startsWith('image/')
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


/** 封闭聊天的图只装进本轮模型上下文；原消息、数据库和界面记录都不写入图片字节。 */
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
