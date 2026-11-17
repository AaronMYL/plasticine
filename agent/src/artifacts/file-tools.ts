// file_save 和 reply_files（11-16 能力总表「文件页：写一个文件」「给他发一个文件」）：Plasticine 能把东西存成文件页里的
// 一个文件（自己写的文字、对话附件、网上下载的），也能把文件页里的文件发给他——发出时存一份成对话附件挂在回答下面，
// 之后文件页里改了、删了，对话里还是发出时那份。覆盖已有文件先把旧的挪进最近删除（能还原）。

import { createHash } from 'node:crypto';
import { Type } from 'typebox';
import { conversationMime } from '../../shared/attachments.ts';
import type { FileWidget } from '../../shared/api/message-widgets.ts';
import { checkedArgs, type KernelTool } from '../lines/index.ts';
import type { StateService } from '../state/index.ts';
import { ArtifactError } from './errors.ts';
import { UPLOAD_MAX_BYTES, pathSegments, type Workspace, type WorkspaceEntry } from './workspace.ts';

/** 一次发几个文件：和他一次能发的附件数一样多，再多该打成一个压缩包。 */
export const REPLY_FILES_MAX = 5;
/** 模型直接写进来的文字最多这么长（再长的该分几次写，或先在别处生成再存）。 */
const TEXT_MAX_CHARS = 2_000_000;

export interface Downloaded {
  data: Buffer;
  /** 对方说的类型（不含参数）；只用来提示，存不存看扩展名和开头几个字节。 */
  type: string;
}

export interface FileToolParts {
  workspace: Workspace;
  state: StateService;
  /** 对话附件归谁（单用户库里是固定的那一个，app/ 给）。 */
  attachmentOwner: string;
  /** 下公网上的一个文件：逐跳核地址、限时限量（app/ 用 PublicFetcher 实现）。 */
  download(url: string, maxBytes: number, signal: AbortSignal): Promise<Downloaded>;
  /** 一次设备动作交回的那份图或文件（tab_shot 的截图、file_fetch 拿来的文件）；没有就抛错说清楚。 */
  deviceFile(actionId: string): Buffer;
}

const SaveParameters = Type.Object({
  path: Type.String({ minLength: 1, maxLength: 1_000,
    description: '文件页里的位置，含文件名，如「导出/候选人.csv」；没有的文件夹会建好。' }),
  text: Type.Optional(Type.String({ maxLength: TEXT_MAX_CHARS, description: '文字内容（md、csv、json、txt 这类）。' })),
  base64: Type.Optional(Type.String({ maxLength: Math.ceil(UPLOAD_MAX_BYTES / 3) * 4,
    description: '二进制内容的 base64（图片、PDF）。' })),
  fromAttachment: Type.Optional(Type.String({ minLength: 1, maxLength: 200,
    description: '他发在对话里的附件 id（附件说明里写着）。' })),
  fromUrl: Type.Optional(Type.String({ minLength: 8, maxLength: 2_000, pattern: '^https?://',
    description: '公网上一个文件的网址：下载下来存。' })),
  fromDeviceAction: Type.Optional(Type.String({ minLength: 1, maxLength: 300,
    description: '一次设备动作的 actionId（device_action 回的）：tab_shot 是 JPEG（存成 .jpg），'
      + 'screen_capture 是 PNG。' })),
  overwrite: Type.Optional(Type.Boolean({ description: '已有同名文件时换掉它（旧的进最近删除，能还原）。' })),
}, { additionalProperties: false });

const ReplyParameters = Type.Object({
  paths: Type.Array(Type.String({ minLength: 1, maxLength: 1_000 }), { minItems: 1, maxItems: REPLY_FILES_MAX,
    uniqueItems: true }),
}, { additionalProperties: false });

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function stable(prefix: string, key: string): string {
  return `${prefix}-${createHash('sha256').update(key).digest('hex').slice(0, 40)}`;
}

function result(value: unknown, details: Record<string, unknown> = {}) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], details };
}

/** 哪个来源的字节：四样只能给一样。 */
async function sourceBytes(parts: FileToolParts, args: ReturnType<typeof checkedArgs<typeof SaveParameters>>,
  signal: AbortSignal): Promise<Buffer> {
  const given = [args.text, args.base64, args.fromAttachment, args.fromUrl, args.fromDeviceAction]
    .filter((value) => value !== undefined);
  if (given.length !== 1) {
    throw new Error('text、base64、fromAttachment、fromUrl、fromDeviceAction 只给一样：这次没有存。');
  }
  if (args.fromDeviceAction !== undefined) {
    return parts.deviceFile(args.fromDeviceAction);
  }
  if (args.text !== undefined) {
    return Buffer.from(args.text, 'utf8');
  }
  if (args.base64 !== undefined) {
    const data = Buffer.from(args.base64, 'base64');
    if (data.toString('base64').replace(/=+$/, '') !== args.base64.replace(/\s+/g, '').replace(/=+$/, '')) {
      throw new Error('base64 内容不完整，没有存。');
    }
    return data;
  }
  if (args.fromAttachment !== undefined) {
    const row = parts.state.attachments.requireOwned(args.fromAttachment, parts.attachmentOwner);
    if (row.status !== 'ready') {
      throw new Error(`附件「${row.name}」现在读不到原件（${row.error ?? '还没传完或已删除'}）。`);
    }
    return parts.state.attachments.readBytes(row.id);
  }
  return (await parts.download(args.fromUrl ?? '', UPLOAD_MAX_BYTES, signal)).data;
}

/** 一层层把没有的文件夹建出来。 */
function ensureFolders(workspace: Workspace, segments: readonly string[]): void {
  for (let depth = 1; depth < segments.length; depth += 1) {
    const folder = segments.slice(0, depth).join('/');
    try {
      if (workspace.stat(folder).kind !== 'directory') {
        throw new ArtifactError('invalid_input', `「${folder}」已经是一个文件，不能当文件夹。`, 'path');
      }
    } catch (cause) {
      if (!(cause instanceof ArtifactError && cause.code === 'not_found')) throw cause;
      workspace.mkdir(folder);
    }
  }
}

function existing(workspace: Workspace, path: string): WorkspaceEntry | null {
  try {
    return workspace.stat(path);
  } catch (cause) {
    if (cause instanceof ArtifactError && cause.code === 'not_found') return null;
    throw cause;
  }
}

/** 存进文件页：同样内容已经在那里（重放、重存）就直接回它；不同内容要 overwrite，旧的先进最近删除。 */
export function saveFile(workspace: Workspace, path: string, data: Buffer, overwrite: boolean)
  : { entry: WorkspaceEntry; replaced: boolean } {
  const segments = pathSegments(path);
  const name = segments.at(-1);
  if (name === undefined) {
    throw new ArtifactError('invalid_input', '要写到一个文件名，不能是文件页的根。', 'path');
  }
  ensureFolders(workspace, segments);
  const clean = segments.join('/');
  const before = existing(workspace, clean);
  if (before !== null) {
    if (before.kind === 'file' && sha256(workspace.read(clean).data) === sha256(data)) {
      return { entry: before, replaced: false };
    }
    if (!overwrite || before.kind !== 'file') {
      throw new ArtifactError('conflict', `文件页里已经有「${clean}」了：换掉它传 overwrite: true（旧的进最近删除），`
        + '或者换个名字。', 'path');
    }
    workspace.trash(clean, name);
  }
  const entry = workspace.upload(segments.slice(0, -1).join('/'), name, data, false);
  return { entry, replaced: before !== null };
}

/** 文件页里的一份 → 对话附件（同一次调用重放拿回同一份）。 */
function attach(parts: FileToolParts, path: string, key: string): FileWidget {
  const { data, entry } = parts.workspace.read(path);
  if (data.length === 0) {
    throw new Error(`「${entry.name}」是空文件，发不了。`);
  }
  const mimeType = conversationMime(entry.type ?? '', entry.name);
  const store = parts.state.attachments;
  const row = store.open({ requestId: stable('reply', key), name: entry.name.slice(0, 200), mimeType,
    bytes: data.length, sha256: sha256(data) }, parts.attachmentOwner);
  if (row.status !== 'ready') {
    store.storeBytes(row.id, data);
    store.finish(row.id, { text: null, truncated: false, error: null });
  }
  return { kind: 'file', id: stable('w', key), attachmentId: row.id, name: row.name, mimeType, bytes: data.length,
    path: entry.path };
}

export function fileTools(parts: FileToolParts): KernelTool[] {
  const save: KernelTool = {
    name: 'file_save',
    say: (args) => (typeof args['path'] === 'string' ? `存文件：${args['path']}` : '存文件'),
    hardLine: () => null,
    create: () => ({
      name: 'file_save', label: '存成文件',
      description: '把一份东西存成文件页里的一个文件：自己写的文字（text）、图片或 PDF（base64）、他发的对话附件'
        + '（fromAttachment）、网上的一个文件（fromUrl）、一次截图（fromDeviceAction，填 device_action 回的 actionId）。'
        + '能存的：txt、md、csv、json、log、yaml、png、jpg、gif、webp、pdf、'
        + 'docx、xlsx、pptx、zip，一个最多 20 MB。要发给他用 reply_files；要传到网页上用存好的路径。',
      parameters: SaveParameters,
      async execute(_callId, input, signal) {
        const args = checkedArgs(SaveParameters, input, 'file_save');
        const data = await sourceBytes(parts, args, signal ?? new AbortController().signal);
        const { entry, replaced } = saveFile(parts.workspace, args.path, data, args.overwrite ?? false);
        return result({ path: entry.path, name: entry.name, bytes: entry.bytes, type: entry.type,
          ...(replaced ? { note: '旧的那份在文件页的最近删除里，能还原。' } : {}) });
      },
    }),
  };
  const reply: KernelTool = {
    name: 'reply_files',
    say: (args) => (Array.isArray(args['paths']) ? `发给你 ${args['paths'].length} 个文件` : '发文件给你'),
    hardLine: () => null,
    create: (scope) => ({
      name: 'reply_files', label: '发文件给他',
      description: `把文件页里的文件（最多 ${REPLY_FILES_MAX} 个）挂在这次回答下面发给他：图片直接显示，别的是一行文件，`
        + '点开预览或下载。发出的是现在这一份。还不在文件页里的先用 file_save 存进去。回答里不用再贴路径。',
      parameters: ReplyParameters,
      async execute(callId, input) {
        const args = checkedArgs(ReplyParameters, input, 'reply_files');
        const widgets = args.paths.map((path) => attach(parts, path, `${scope.lineId}:${callId}:${path}`));
        return result({ sent: widgets.map((widget) => widget.name),
          note: '已挂在这次回答下面。' }, { widgets });
      },
    }),
  };
  return [save, reply];
}
