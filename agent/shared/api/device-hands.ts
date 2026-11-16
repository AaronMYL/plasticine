// 设备动作里 11-16 能力总表补上的几种（和 iPhone 那几种放 device-ios.ts 一样，单独一份，devices.ts 摊进去）：网页标签里
// 按键、按位置滚、带格式粘贴、提到前面让他接手一步、往上传框放文件；文件在设备和服务器之间搬。
// 设备路径和网页标签标识也在这里定义（devices.ts 照旧导出），免得两份文件互相引用。

import { Type } from 'typebox';
import type { DeviceActionClass, DeviceActionKind } from '../state.ts';
import { OrNull } from './lineage.ts';
import { PAGE_SCROLL_MAX } from './page-operate.ts';

const STRICT = { additionalProperties: false };

// A path on the device: absolute or under ~ (设备不补判断：相对路径不收).
export const DevicePathSchema = Type.String({ minLength: 1, maxLength: 1_000 });
// 网页标签的标识由 Mac 给（tab_list / tab_open 的回执里有），网页界面里开的标签也是同一个标识。
export const WebTabIdSchema = Type.String({ minLength: 1, maxLength: 100 });

/** 能按的键：方向、翻页、退格、Esc、Tab、空格和单个字母数字，可带修饰键（Meta 是 Mac 的 ⌘）。回车不在里面：
 * 回车常常就是发送，照旧走 tab_act 的 enter（提交前问他）。 */
export const TAB_KEY_PATTERN = '^((Meta|Control|Alt|Shift)\\+){0,3}(Escape|Tab|ArrowUp|ArrowDown|ArrowLeft|'
  + 'ArrowRight|Home|End|PageUp|PageDown|Backspace|Delete|Space|[A-Za-z0-9])$';
/** 一次粘贴最多这么多字（一篇长文章的正文和排版）。 */
export const TAB_PASTE_MAX_CHARS = 400_000;
/** 设备和服务器之间搬一个文件、往上传框放的几个文件加起来最多这么大：base64 之后还在回执和下发的上限以内。 */
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
  /** 按一个键或组合键（发给当前焦点）：关弹窗、在下拉里移动、全选。回车不收。 */
  Type.Object({ kind: Type.Literal('tab_key'), tabId: WebTabIdSchema,
    key: Type.String({ minLength: 1, maxLength: 40, pattern: TAB_KEY_PATTERN }) }, STRICT),
  /** 在画面上这个位置滚（像鼠标滚轮）：会话列表、弹窗里的长列表这类整页翻页翻不到的。 */
  Type.Object({ kind: Type.Literal('tab_scroll'), tabId: WebTabIdSchema, x: Type.Integer({ minimum: 0 }),
    y: Type.Integer({ minimum: 0 }), dy: Scroll }, STRICT),
  /** 往当前焦点里粘贴：html 给了按带格式的粘（编辑器认排版），text 是纯文字那一份。不碰他电脑的剪贴板。 */
  Type.Object({ kind: Type.Literal('tab_paste'), tabId: WebTabIdSchema,
    text: Type.String({ minLength: 1, maxLength: TAB_PASTE_MAX_CHARS }),
    html: OrNull(Type.String({ minLength: 1, maxLength: TAB_PASTE_MAX_CHARS })) }, STRICT),
  /** 把这个标签提到前面给他看（他要接手一步：登录、扫码、验证码）。 */
  Type.Object({ kind: Type.Literal('tab_show'), tabId: WebTabIdSchema }, STRICT),
  /** 往编号 n 的上传框（或点了会弹「选择文件」的按钮）放文件，不弹系统窗口；文件内容由服务端从文件页放进来。 */
  Type.Object({ kind: Type.Literal('tab_upload'), tabId: WebTabIdSchema,
    version: Type.String({ minLength: 1, maxLength: 40 }), n: Type.Integer({ minimum: 1 }),
    files: Type.Array(UploadFileSchema, { minItems: 1, maxItems: TAB_UPLOAD_FILES_MAX }) }, STRICT),
  /** 把设备上一个文件整份拿到服务器（服务端存进文件页）。 */
  Type.Object({ kind: Type.Literal('file_fetch'), path: DevicePathSchema }, STRICT),
  /** 把一份文件放到设备上这个位置（内容由服务端从文件页放进来）；已有同名的要 overwrite。 */
  Type.Object({ kind: Type.Literal('file_put'), path: DevicePathSchema, base64: Base64Schema,
    overwrite: Type.Boolean() }, STRICT),
] as const;
