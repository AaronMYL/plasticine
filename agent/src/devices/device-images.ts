// 截图（screen_capture 的 png）和 iPhone 读一张照片（photo_read 的 jpeg）的回执里是整张图的 base64。
// 记录里原样留着；交给模型时把图拿出来当图片（ToolResult.images），文字里只留尺寸和一句说明——
// 塞进文字的 base64 会被工具结果的字数上限截断，模型既看不到图也读不懂那串字。

import type { DeviceActionKind } from '../../shared/state.ts';
import type { ModelImage } from '../../shared/model.ts';

// ModelImage 一张图的上限（brain/tools/dispatch.ts 的 emitImage 同一个数）。
export const DEVICE_IMAGE_MAX_CHARS = 8_000_000;
const SHOWN_AS_IMAGE = '[图片已经作为图像交给模型，这里不重复]';

const IMAGE_FIELDS: Partial<Readonly<Record<DeviceActionKind, { field: string; mimeType: ModelImage['mimeType'] }>>> = {
  screen_capture: { field: 'png', mimeType: 'image/png' },
  photo_read: { field: 'jpeg', mimeType: 'image/jpeg' },
};

export interface SplitImage {
  /** The result with the picture replaced by a marker, for the text the model reads. */
  result: unknown;
  image: ModelImage | null;
}

/** Takes the picture out of a device result, or leaves the result as it is when there is none to take. */
export function splitDeviceImage(kind: DeviceActionKind, actionId: string, result: unknown): SplitImage {
  const spec = IMAGE_FIELDS[kind];
  if (spec === undefined || typeof result !== 'object' || result === null) {
    return { result, image: null };
  }
  const data: unknown = Reflect.get(result, spec.field);
  if (typeof data !== 'string' || data === '' || data.length > DEVICE_IMAGE_MAX_CHARS) {
    return { result, image: null };
  }
  const image: ModelImage = { type: 'image', attachmentId: `device:${actionId}`, mimeType: spec.mimeType, data };
  return { result: { ...result, [spec.field]: SHOWN_AS_IMAGE }, image };
}
