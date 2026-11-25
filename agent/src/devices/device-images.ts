import type { DeviceActionKind } from '../../shared/state.ts';
import type { ModelImage } from '../../shared/model.ts';

export const DEVICE_IMAGE_MAX_CHARS = 8_000_000;
const SHOWN_AS_IMAGE = '[图片已经作为图像交给模型，这里不重复]';

const IMAGE_FIELDS: Partial<Readonly<Record<DeviceActionKind, { field: string; mimeType: ModelImage['mimeType'] }>>> = {
  screen_capture: { field: 'png', mimeType: 'image/png' },
  tab_shot: { field: 'jpeg', mimeType: 'image/jpeg' },
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
