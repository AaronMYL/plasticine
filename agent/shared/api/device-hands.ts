import { Type } from 'typebox';
import type { DeviceActionClass, DeviceActionKind } from '../state.ts';
import { OrNull } from './lineage.ts';
import { PAGE_SCROLL_MAX } from './page-operate.ts';

const STRICT = { additionalProperties: false };

export const DevicePathSchema = Type.String({ minLength: 1, maxLength: 1_000 });
export const WebTabIdSchema = Type.String({ minLength: 1, maxLength: 100 });

export const TAB_KEY_PATTERN = '^((Meta|Control|Alt|Shift)\\+){0,3}(Escape|Tab|ArrowUp|ArrowDown|ArrowLeft|'
  + 'ArrowRight|Home|End|PageUp|PageDown|Backspace|Delete|Space|[A-Za-z0-9])$';
export const TAB_PASTE_MAX_CHARS = 400_000;
export const DEVICE_FILE_MAX_BYTES = 15 * 1024 * 1024;
export const TAB_UPLOAD_FILES_MAX = 9;
const Base64Schema = Type.String({ minLength: 1, maxLength: Math.ceil(DEVICE_FILE_MAX_BYTES / 3) * 4,
  pattern: '^[A-Za-z0-9+/]+={0,2}$' });
const UploadFileSchema = Type.Object({ name: Type.String({ minLength: 1, maxLength: 255 }),
  mimeType: Type.String({ minLength: 3, maxLength: 160 }), base64: Base64Schema }, STRICT);
const Scroll = Type.Integer({ minimum: -PAGE_SCROLL_MAX, maximum: PAGE_SCROLL_MAX });

type HandKind = Extract<DeviceActionKind, 'tab_key' | 'tab_scroll' | 'tab_paste' | 'tab_show' | 'tab_upload'
  | 'file_fetch' | 'file_put'>;

export const HAND_KIND_LABELS: Readonly<Record<HandKind, string>> = {
  tab_key: '在网页标签里按键',
  tab_scroll: '在网页标签里按位置滚',
  tab_paste: '在网页标签里粘贴',
  tab_show: '把网页标签提到前面',
  tab_upload: '往网页上传框放文件',
  file_fetch: '把设备上的文件拿到服务器',
  file_put: '把文件放到设备上',
};

export const HAND_KIND_CLASSES: Readonly<Record<HandKind, DeviceActionClass>> = {
  tab_key: 'input',
  tab_scroll: 'browser',
  tab_paste: 'input',
  tab_show: 'browser',
  tab_upload: 'input',
  file_fetch: 'read',
  file_put: 'write',
};

export const HAND_ACTION_PARAM_SCHEMAS = [
  Type.Object({ kind: Type.Literal('tab_key'), tabId: WebTabIdSchema,
    key: Type.String({ minLength: 1, maxLength: 40, pattern: TAB_KEY_PATTERN }) }, STRICT),
  Type.Object({ kind: Type.Literal('tab_scroll'), tabId: WebTabIdSchema, x: Type.Integer({ minimum: 0 }),
    y: Type.Integer({ minimum: 0 }), dy: Scroll }, STRICT),
  Type.Object({ kind: Type.Literal('tab_paste'), tabId: WebTabIdSchema,
    text: Type.String({ minLength: 1, maxLength: TAB_PASTE_MAX_CHARS }),
    html: OrNull(Type.String({ minLength: 1, maxLength: TAB_PASTE_MAX_CHARS })) }, STRICT),
  Type.Object({ kind: Type.Literal('tab_show'), tabId: WebTabIdSchema }, STRICT),
  Type.Object({ kind: Type.Literal('tab_upload'), tabId: WebTabIdSchema,
    version: Type.String({ minLength: 1, maxLength: 40 }), n: Type.Integer({ minimum: 1 }),
    files: Type.Array(UploadFileSchema, { minItems: 1, maxItems: TAB_UPLOAD_FILES_MAX }) }, STRICT),
  Type.Object({ kind: Type.Literal('file_fetch'), path: DevicePathSchema }, STRICT),
  Type.Object({ kind: Type.Literal('file_put'), path: DevicePathSchema, base64: Base64Schema,
    overwrite: Type.Boolean() }, STRICT),
] as const;
