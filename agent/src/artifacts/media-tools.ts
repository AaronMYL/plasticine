// image_generate、image_edit、audio_transcribe（11-16 能力总表「生成图片」「改图片」「音频转文字」）：出图用来信配图
// 那一路的模型，改图用 ffmpeg，转写用本地转写；三样都从文件页拿、存回文件页。具体怎么做由 app/ 接上（kernel/、
// cloud-tools/、video/），这里只管参数、读写文件页和回什么。

import { Type, type Static } from 'typebox';
import { checkedArgs, type KernelTool } from '../lines/index.ts';
import { ArtifactError } from './errors.ts';
import { saveFile } from './file-tools.ts';
import { extensionOf } from './file-types.ts';
import { IMAGE_EXTENSIONS, MEDIA_EXTENSIONS } from './office/convert.ts';
import { pixelSize } from './office/package-xml.ts';
import { pathSegments, type Workspace } from './workspace.ts';

const Box = { x: Type.Integer({ minimum: 0 }), y: Type.Integer({ minimum: 0 }),
  width: Type.Integer({ minimum: 1, maximum: 8_000 }), height: Type.Integer({ minimum: 1, maximum: 8_000 }) };
export const ImageOpSchema = Type.Union([
  Type.Object({ op: Type.Literal('crop'), ...Box }, { additionalProperties: false }),
  Type.Object({ op: Type.Literal('resize'), width: Type.Optional(Type.Integer({ minimum: 2, maximum: 8_000 })),
    height: Type.Optional(Type.Integer({ minimum: 2, maximum: 8_000 })) }, { additionalProperties: false }),
  Type.Object({ op: Type.Literal('blur'), ...Box }, { additionalProperties: false }),
  Type.Object({ op: Type.Literal('text'), text: Type.String({ minLength: 1, maxLength: 200 }),
    x: Type.Integer({ minimum: 0 }), y: Type.Integer({ minimum: 0 }),
    size: Type.Optional(Type.Integer({ minimum: 8, maximum: 400 })),
    color: Type.Optional(Type.String({ pattern: '^#?[0-9a-fA-F]{6}$' })) }, { additionalProperties: false }),
  Type.Object({ op: Type.Literal('rotate'), degrees: Type.Union([Type.Literal(90), Type.Literal(180),
    Type.Literal(270)]) }, { additionalProperties: false }),
]);
export type ImageOpInput = Static<typeof ImageOpSchema>;

export interface Drawn {
  data: Buffer;
  /** image/png、image/jpeg、image/webp。 */
  mime: string;
}

export interface MediaToolParts {
  workspace: Workspace;
  editImage(inputs: { data: Buffer; extension: string }[], ops: ImageOpInput[], output: string,
    signal: AbortSignal, options: { join?: 'horizontal' | 'vertical'; joinSize?: number; quality?: number }):
    Promise<Buffer>;
  /** 按描述出一张图；没有能出图的模型、模型拒了都回 error。 */
  draw(prompt: string, signal: AbortSignal): Promise<Drawn | { error: string }>;
  transcribe(input: { data: Buffer; extension: string }, signal: AbortSignal):
    Promise<{ text: string; seconds: number | null; engine: string }>;
}

/** 逐字稿直接回给模型的最多这么长；再长的存成文件（saveTo）再分段读。 */
const TRANSCRIPT_REPLY_MAX = 30_000;
const IMAGE_OUT = ['png', 'jpg', 'jpeg', 'webp'];
const MIME_EXTENSIONS: Readonly<Record<string, string>> = { 'image/png': 'png', 'image/jpeg': 'jpg',
  'image/webp': 'webp' };

const EditParameters = Type.Object({
  from: Type.Union([Type.String({ minLength: 1, maxLength: 1_000 }), Type.Array(Type.String({ minLength: 1,
    maxLength: 1_000 }), { minItems: 1, maxItems: 9 })], { description: '文件页里的一张图；给几张就先拼成一张。' }),
  to: Type.String({ minLength: 1, maxLength: 1_000, description: '存到哪里，扩展名 png、jpg、webp。' }),
  ops: Type.Array(ImageOpSchema, { maxItems: 20, description: '按顺序做：crop 裁剪、resize 缩放（只给宽或高就等比）、'
    + 'blur 打码（一块区域）、text 加字、rotate 顺时针转。坐标是像素，以那一步的图为准。' }),
  join: Type.Optional(Type.Union([Type.Literal('horizontal'), Type.Literal('vertical')],
    { description: '几张图怎么拼：横着（默认）还是竖着。' })),
  joinSize: Type.Optional(Type.Integer({ minimum: 16, maximum: 8_000,
    description: '拼图时每张统一的高（横拼）或宽（竖拼），默认 1080。' })),
  quality: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, description: 'jpg、webp 的质量（压缩），默认 85。' })),
  overwrite: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

const GenerateParameters = Type.Object({
  prompt: Type.String({ minLength: 1, maxLength: 1_000, description: '画面描述：主体、场景、风格、构图。' }),
  path: Type.String({ minLength: 1, maxLength: 1_000,
    description: '存到文件页的哪里，如「封面/第三期.png」；扩展名按出来的图改。' }),
  overwrite: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

const TranscribeParameters = Type.Object({
  path: Type.String({ minLength: 1, maxLength: 1_000, description: '文件页里的音频或视频（mp3、m4a、wav、mp4、mov）。' }),
  saveTo: Type.Optional(Type.String({ minLength: 1, maxLength: 1_000,
    description: '把逐字稿存成文件页里的一个 .txt 或 .md（长录音建议存）。' })),
  overwrite: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

function result(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], details: {} };
}

function readImage(workspace: Workspace, path: string): { data: Buffer; extension: string } {
  const { data, entry } = workspace.read(path);
  const extension = extensionOf(entry.name);
  if (!IMAGE_EXTENSIONS.includes(extension)) {
    throw new ArtifactError('unsupported_type', `「${path}」不是图片（能改的：${IMAGE_EXTENSIONS.join('、')}）。`, 'from');
  }
  return { data, extension };
}

/** 出来的图是什么格式，路径就用什么扩展名（没写扩展名的补上，写错的换掉）。 */
export function pathForMime(path: string, mime: string): string {
  const extension = MIME_EXTENSIONS[mime] ?? 'png';
  const segments = pathSegments(path);
  const name = segments.at(-1) ?? 'image';
  const base = IMAGE_EXTENSIONS.includes(extensionOf(name)) ? name.replace(/\.[^.]+$/, '') : name;
  return [...segments.slice(0, -1), `${base}.${extension}`].join('/');
}

function editTool(parts: MediaToolParts): KernelTool {
  return {
    name: 'image_edit',
    say: (args) => (typeof args['to'] === 'string' ? `改图：${args['to']}` : '改图'),
    hardLine: () => null,
    create: () => ({
      name: 'image_edit', label: '改图',
      description: '改文件页里的图另存一份（原图不动）：裁剪、缩放、压缩（quality）、打码、加字、旋转，几张图拼成一张。'
        + '回结果的宽高；不知道原图多大时先不带 ops 存一份看宽高，再给坐标。',
      parameters: EditParameters,
      async execute(_callId, input, signal) {
        const args = checkedArgs(EditParameters, input, 'image_edit');
        const output = extensionOf(args.to);
        if (!IMAGE_OUT.includes(output)) {
          throw new ArtifactError('unsupported_type', '改好的图存成 png、jpg 或 webp。', 'to');
        }
        const sources = (Array.isArray(args.from) ? args.from : [args.from])
          .map((path) => readImage(parts.workspace, path));
        const data = await parts.editImage(sources, args.ops, output, signal ?? new AbortController().signal, {
          ...(args.join === undefined ? {} : { join: args.join }),
          ...(args.joinSize === undefined ? {} : { joinSize: args.joinSize }),
          ...(args.quality === undefined ? {} : { quality: args.quality }) });
        const { entry, replaced } = saveFile(parts.workspace, args.to, data, args.overwrite ?? false);
        const size = pixelSize(data);
        return result({ path: entry.path, bytes: entry.bytes,
          ...(size === null ? {} : { width: size.width, height: size.height }),
          ...(replaced ? { note: '旧的那份在文件页的最近删除里，能还原。' } : {}) });
      },
    }),
  };
}

function generateTool(parts: MediaToolParts): KernelTool {
  return {
    name: 'image_generate',
    say: () => '出图',
    hardLine: () => null,
    create: () => ({
      name: 'image_generate', label: '出图',
      description: '按画面描述画一张图存进文件页（封面、配图、头像这类）。不画真人的脸、不画别人的商标和有版权的角色。'
        + '要发给他再用 reply_files。',
      parameters: GenerateParameters,
      async execute(_callId, input, signal) {
        const args = checkedArgs(GenerateParameters, input, 'image_generate');
        const drawn = await parts.draw(args.prompt, signal ?? new AbortController().signal);
        if ('error' in drawn) {
          throw new Error(`没画出来：${drawn.error}`);
        }
        const path = pathForMime(args.path, drawn.mime);
        const { entry, replaced } = saveFile(parts.workspace, path, drawn.data, args.overwrite ?? false);
        return result({ path: entry.path, bytes: entry.bytes,
          ...(replaced ? { note: '旧的那份在文件页的最近删除里，能还原。' } : {}) });
      },
    }),
  };
}

function transcribeTool(parts: MediaToolParts): KernelTool {
  return {
    name: 'audio_transcribe',
    say: (args) => (typeof args['path'] === 'string' ? `转文字：${args['path']}` : '音频转文字'),
    hardLine: () => null,
    create: () => ({
      name: 'audio_transcribe', label: '音频转文字',
      description: '把文件页里的一段录音或视频转成带时间的逐字稿（本机转写，不上传）。十分钟的录音大约一两分钟。',
      parameters: TranscribeParameters,
      async execute(_callId, input, signal) {
        const args = checkedArgs(TranscribeParameters, input, 'audio_transcribe');
        const { data, entry } = parts.workspace.read(args.path);
        const extension = extensionOf(entry.name);
        if (!MEDIA_EXTENSIONS.includes(extension)) {
          throw new ArtifactError('unsupported_type', `「${args.path}」不是音频或视频（能转：${MEDIA_EXTENSIONS.join('、')}）。`,
            'path');
        }
        const transcript = await parts.transcribe({ data, extension }, signal ?? new AbortController().signal);
        let saved: string | null = null;
        if (args.saveTo !== undefined) {
          saved = saveFile(parts.workspace, args.saveTo, Buffer.from(transcript.text, 'utf8'),
            args.overwrite ?? false).entry.path;
        }
        const text = Array.from(transcript.text);
        return result({ seconds: transcript.seconds, engine: transcript.engine, ...(saved === null ? {} : { saved }),
          text: text.slice(0, TRANSCRIPT_REPLY_MAX).join(''),
          ...(text.length > TRANSCRIPT_REPLY_MAX ? { truncated: true, note: '太长只回了前面一段：用 saveTo 存成文件再读。' }
            : {}) });
      },
    }),
  };
}

export function mediaTools(parts: MediaToolParts): KernelTool[] {
  return [generateTool(parts), editTool(parts), transcribeTool(parts)];
}
