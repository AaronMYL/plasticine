// 图片和音视频用 ffmpeg 转格式、改图（11-16 能力总表「格式转换」「改图片」）：不加新包，用本体机器上已有的 ffmpeg
// （装了本地转写就用组件里的，没装用系统里的，由调用方给路径）。一次一个临时目录，用完就删；限时、不联网
// （输入输出都是本地文件，参数里不带任何网址）。

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CloudToolError } from './errors.ts';

/** 一次转换最多等这么久：几分钟的音频、几十 MB 的视频在 2 核上一两分钟内转得完。 */
const FFMPEG_TIMEOUT_MS = 5 * 60 * 1000;
/** 出来的文件最多这么大（和文件页一个文件的上限一样量级）。 */
const OUTPUT_MAX_BYTES = 200 * 1024 * 1024;
/** 改图时图片的边最长这么多像素：再大的先缩，免得一个滤镜吃光内存。 */
export const IMAGE_SIDE_MAX = 8_000;
/** 打码的模糊半径：20 像素看不出字。 */
const BLUR_RADIUS_MAX = 20;

export const IMAGE_FORMATS = ['png', 'jpg', 'jpeg', 'webp', 'gif'] as const;
export const AUDIO_FORMATS = ['mp3', 'm4a', 'wav'] as const;
export const VIDEO_FORMATS = ['mp4', 'mov'] as const;

/** 加字用的中文字体：常见位置挨个找，找到哪个用哪个（ffmpeg 的 drawtext 不会按字回退别的字体）。 */
const CJK_FONTS = [
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
  '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
  '/System/Library/Fonts/PingFang.ttc',
  '/System/Library/Fonts/STHeiti Medium.ttc',
  'C:\\Windows\\Fonts\\msyh.ttc',
];

export type ImageOp =
  | { op: 'crop'; x: number; y: number; width: number; height: number }
  | { op: 'resize'; width?: number; height?: number }
  | { op: 'blur'; x: number; y: number; width: number; height: number }
  | { op: 'text'; text: string; x: number; y: number; size?: number; color?: string }
  | { op: 'rotate'; degrees: 90 | 180 | 270 };

export interface MediaInput {
  data: Buffer;
  /** 扩展名（不带点、小写）。 */
  extension: string;
}

function run(ffmpeg: string, args: readonly string[], signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { signal: AbortSignal.any([signal, AbortSignal.timeout(FFMPEG_TIMEOUT_MS)]),
      stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let err = '';
    child.stderr.on('data', (chunk: Buffer) => {
      err = `${err}${chunk.toString('utf8')}`.slice(-2_000);
    });
    child.on('error', (cause) => {
      const missing = (cause as NodeJS.ErrnoException).code === 'ENOENT';
      reject(new CloudToolError('not_configured', missing ? '这台机器上没有 ffmpeg，转不了图片和音视频。'
        : `ffmpeg 没起来：${cause.message}`));
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      // 第一行通常说的是真正的原因（最后一行多是「没写出东西」这种结果）。
      const first = err.trim().split('\n')[0]?.replace(/^\[[^\]]*\]\s*/, '').slice(0, 200) ?? '';
      reject(new CloudToolError('invalid_input', `ffmpeg 没转成（退出码 ${String(code)}）：${first}`));
    });
  });
}

/** 在一个临时目录里跑：输入写成 in0.扩展名、in1…，输出 out.扩展名；用完删掉目录。 */
async function inTemp(ffmpeg: string, inputs: readonly MediaInput[], output: string,
  args: (dir: string, inputs: readonly string[], output: string) => string[] | Promise<string[]>, signal: AbortSignal):
  Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'plasticine-media-'));
  try {
    const paths = await Promise.all(inputs.map(async (input, index) => {
      const path = join(dir, `in${index}.${input.extension}`);
      await writeFile(path, input.data);
      return path;
    }));
    const out = join(dir, `out.${output}`);
    await run(ffmpeg, ['-nostdin', '-loglevel', 'error', '-y', ...await args(dir, paths, out)], signal);
    const data = await readFile(out);
    if (data.length === 0 || data.length > OUTPUT_MAX_BYTES) {
      throw new CloudToolError('invalid_input', data.length === 0 ? 'ffmpeg 转出来是空的。' : '转出来太大了（超过 200 MB）。');
    }
    return data;
  } finally {
    // 这次自己建的临时目录，用完就清。
    await rm(dir, { recursive: true, force: true });
  }
}

function qualityArgs(output: string, quality: number | undefined): string[] {
  const q = Math.min(100, Math.max(1, Math.round(quality ?? 85)));
  if (output === 'jpg' || output === 'jpeg') {
    // ffmpeg 的 JPEG 质量是 2（最好）到 31：把 1–100 映过去。
    return ['-q:v', String(Math.round(31 - (q / 100) * 29))];
  }
  if (output === 'webp') {
    return ['-c:v', 'libwebp', '-quality', String(q)];
  }
  return [];
}

/** 一种格式转成另一种：图片之间、音频之间、视频转音频（抽声音）、视频之间。 */
export async function convertMedia(ffmpeg: string, input: MediaInput, output: string, signal: AbortSignal,
  quality?: number): Promise<Buffer> {
  const image = (IMAGE_FORMATS as readonly string[]).includes(output);
  const audio = (AUDIO_FORMATS as readonly string[]).includes(output);
  return inTemp(ffmpeg, [input], output, (_dir, [path], out) => {
    const source = ['-i', path ?? ''];
    if (image) {
      return [...source, '-frames:v', '1', ...qualityArgs(output, quality), out];
    }
    if (audio) {
      return [...source, '-vn', ...(output === 'mp3' ? ['-codec:a', 'libmp3lame', '-q:a', '3'] : []), out];
    }
    return [...source, out];
  }, signal);
}

function even(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

function fontFile(): string | null {
  return CJK_FONTS.find((path) => existsSync(path)) ?? null;
}

/** ffmpeg 滤镜参数里的路径要转义冒号、反斜杠和引号。 */
function filterPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/([:'])/g, '\\$1');
}

function opFilter(op: ImageOp, at: string, next: string, textFile: () => string): string {
  switch (op.op) {
    case 'crop':
      return `[${at}]crop=${op.width}:${op.height}:${op.x}:${op.y}[${next}]`;
    case 'resize': {
      const width = op.width === undefined ? -2 : even(op.width);
      const height = op.height === undefined ? -2 : even(op.height);
      return `[${at}]scale=${width}:${height}[${next}]`;
    }
    case 'rotate': {
      const transpose = { 90: 'transpose=1', 180: 'transpose=1,transpose=1', 270: 'transpose=2' }[op.degrees];
      return `[${at}]${transpose}[${next}]`;
    }
    case 'blur': {
      // boxblur 的半径不能超过这块短边的一半，色度那一层（宽高减半）不能超过四分之一：小块打码会直接失败。
      const side = Math.min(op.width, op.height);
      const luma = Math.max(1, Math.min(BLUR_RADIUS_MAX, Math.floor(side / 2) - 1));
      const chroma = Math.max(0, Math.min(luma, Math.floor(side / 4) - 1));
      return `[${at}]split[${next}a][${next}b];[${next}b]crop=${op.width}:${op.height}:${op.x}:${op.y},`
        + `boxblur=lr=${luma}:lp=3:cr=${chroma}:cp=3[${next}c];[${next}a][${next}c]overlay=${op.x}:${op.y}[${next}]`;
    }
    case 'text': {
      const font = fontFile();
      const color = /^#?[0-9a-f]{6}$/i.test(op.color ?? '') ? `0x${(op.color ?? '').replace('#', '')}` : 'white';
      // expansion=none：字里的 % 不当成 drawtext 的占位符（不然「100%」整行画不出来）。
      return `[${at}]drawtext=textfile='${filterPath(textFile())}':expansion=none`
        + `${font === null ? '' : `:fontfile='${filterPath(font)}'`}:fontsize=${Math.round(op.size ?? 48)}`
        + `:fontcolor=${color}:x=${op.x}:y=${op.y}:borderw=2:bordercolor=black@0.6[${next}]`;
    }
  }
}

/** 拼图时每张缩到的高（横拼）或宽（竖拼），没说就用这个。 */
export const JOIN_SIZE_DEFAULT = 1080;

export interface EditOptions {
  join?: 'horizontal' | 'vertical';
  /** 拼图时统一的高（横拼）或宽（竖拼），像素。 */
  joinSize?: number;
  quality?: number;
}

/**
 * 改图：几张图先按方向拼成一张（join），再按顺序做 ops（裁剪、缩放、打码、加字、旋转），存成 output 格式。
 * 坐标、尺寸都是像素，以当时那一步的图为准。
 */
export async function editImage(ffmpeg: string, inputs: readonly MediaInput[], ops: readonly ImageOp[],
  output: string, signal: AbortSignal, options: EditOptions = {}): Promise<Buffer> {
  if (inputs.length === 0) {
    throw new CloudToolError('invalid_input', '至少要一张图。');
  }
  return inTemp(ffmpeg, inputs, output, async (dir, paths, out) => {
    const texts = ops.flatMap((op) => (op.op === 'text' ? [op.text] : []));
    const textFiles = await Promise.all(texts.map(async (text, index) => {
      const path = join(dir, `text${index}.txt`);
      await writeFile(path, text);
      return path;
    }));
    let nextText = 0;
    const textFile = (): string => textFiles[nextText++] ?? '';
    const vertical = options.join === 'vertical';
    const size = even(Math.min(IMAGE_SIDE_MAX, options.joinSize ?? JOIN_SIZE_DEFAULT));
    const limit = paths.length > 1 ? (vertical ? `scale=${size}:-2` : `scale=-2:${size}`)
      : `scale='min(${IMAGE_SIDE_MAX},iw)':'min(${IMAGE_SIDE_MAX},ih)':force_original_aspect_ratio=decrease`;
    const graph = paths.map((_, index) => `[${index}:v]${limit},format=rgba[s${index}]`);
    let at = 's0';
    if (paths.length > 1) {
      const stack = paths.map((_, index) => `[s${index}]`).join('');
      graph.push(`${stack}${vertical ? 'vstack' : 'hstack'}=inputs=${paths.length}[j]`);
      at = 'j';
    }
    ops.forEach((op, index) => {
      graph.push(opFilter(op, at, `o${index}`, textFile));
      at = `o${index}`;
    });
    graph.push(`[${at}]null[out]`);
    return [...paths.flatMap((path) => ['-i', path]), '-filter_complex', graph.join(';'), '-map', '[out]',
      '-frames:v', '1', ...qualityArgs(output, options.quality), out];
  }, signal);
}
