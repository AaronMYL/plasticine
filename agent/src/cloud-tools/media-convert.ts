import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CloudToolError } from './errors.ts';

const FFMPEG_TIMEOUT_MS = 5 * 60 * 1000;
const OUTPUT_MAX_BYTES = 200 * 1024 * 1024;
export const IMAGE_SIDE_MAX = 8_000;
const BLUR_RADIUS_MAX = 20;

export const IMAGE_FORMATS = ['png', 'jpg', 'jpeg', 'webp', 'gif'] as const;
export const AUDIO_FORMATS = ['mp3', 'm4a', 'wav'] as const;
export const VIDEO_FORMATS = ['mp4', 'mov'] as const;

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
      const first = err.trim().split('\n')[0]?.replace(/^\[[^\]]*\]\s*/, '').slice(0, 200) ?? '';
      reject(new CloudToolError('invalid_input', `ffmpeg 没转成（退出码 ${String(code)}）：${first}`));
    });
  });
}

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
    await rm(dir, { recursive: true, force: true });
  }
}

function qualityArgs(output: string, quality: number | undefined): string[] {
  const q = Math.min(100, Math.max(1, Math.round(quality ?? 85)));
  if (output === 'jpg' || output === 'jpeg') {
    return ['-q:v', String(Math.round(31 - (q / 100) * 29))];
  }
  if (output === 'webp') {
    return ['-c:v', 'libwebp', '-quality', String(q)];
  }
  return [];
}

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
      const side = Math.min(op.width, op.height);
      const luma = Math.max(1, Math.min(BLUR_RADIUS_MAX, Math.floor(side / 2) - 1));
      const chroma = Math.max(0, Math.min(luma, Math.floor(side / 4) - 1));
      return `[${at}]split[${next}a][${next}b];[${next}b]crop=${op.width}:${op.height}:${op.x}:${op.y},`
        + `boxblur=lr=${luma}:lp=3:cr=${chroma}:cp=3[${next}c];[${next}a][${next}c]overlay=${op.x}:${op.y}[${next}]`;
    }
    case 'text': {
      const font = fontFile();
      const color = /^#?[0-9a-f]{6}$/i.test(op.color ?? '') ? `0x${(op.color ?? '').replace('#', '')}` : 'white';
      return `[${at}]drawtext=textfile='${filterPath(textFile())}':expansion=none`
        + `${font === null ? '' : `:fontfile='${filterPath(font)}'`}:fontsize=${Math.round(op.size ?? 48)}`
        + `:fontcolor=${color}:x=${op.x}:y=${op.y}:borderw=2:bordercolor=black@0.6[${next}]`;
    }
  }
}

export const JOIN_SIZE_DEFAULT = 1080;

export interface EditOptions {
  join?: 'horizontal' | 'vertical';
  joinSize?: number;
  quality?: number;
}

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
