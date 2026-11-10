// 下载与抽音频（《优化清单》第 9 条）：都在本体所在的机器上做。抖音的下载地址由他 Mac 上取好交来（可能绑登录或 IP，
// 服务器上下载不了就如实记原因）；别的网站的视频交给 yt-dlp（装了才有），直链的 mp4 直接下。
// 下载地址里常带签名参数，不进日志、不进错误文字。

import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { PublicFetcher, type PublicRequest } from '../cloud-tools/index.ts';

/** 一条视频最多下这么大：抖音 10 分钟 1080p 约 150 MB。 */
export const VIDEO_DOWNLOAD_MAX_BYTES = 600 * 1024 * 1024;
/** 一张图最多这么大。 */
export const IMAGE_DOWNLOAD_MAX_BYTES = 12 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const FFMPEG_TIMEOUT_MS = 10 * 60 * 1000;
const YT_DLP_TIMEOUT_MS = 15 * 60 * 1000;
// 抖音 CDN 要带作品页当来源，不带会 403。
const DOUYIN_REFERER = 'https://www.douyin.com/';
const BROWSER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) '
  + 'Version/18.0 Safari/605.1.15';

export class MediaError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MediaError';
  }
}

const mediaFetcher = new PublicFetcher();
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/avif']);
const TEXT_DOWNLOAD_MAX_BYTES = 5 * 1024 * 1024;

function specification(url: string, maxBytes: number, types: ReadonlySet<string> | null = null): PublicRequest {
  const host = new URL(url).hostname;
  const douyin = /(douyin|douyinvod|douyinpic|bytecdn|byteimg|amemv|snssdk|zjcdn)\./.test(host);
  return { accept: '*/*', userAgent: BROWSER_AGENT, maxBytes, types, timeoutMs: DOWNLOAD_TIMEOUT_MS,
    ...(douyin ? { referer: DOUYIN_REFERER } : {}) };
}

/** 大视频按块写入文件；DNS与每次重定向都由公网下载器校验。 */
export async function downloadTo(url: string, file: string, signal: AbortSignal,
  maxBytes = VIDEO_DOWNLOAD_MAX_BYTES): Promise<number> {
  return mediaFetcher.read(url, specification(url, maxBytes), signal, async (chunks) => {
    let bytes = 0;
    const counted = async function* () {
      for await (const chunk of chunks) { bytes += chunk.length; yield chunk; }
    };
    await pipeline(Readable.from(counted()), createWriteStream(file), { signal });
    return bytes;
  });
}

export async function fetchText(url: string, signal: AbortSignal): Promise<string> {
  return (await mediaFetcher.get(url, specification(url, TEXT_DOWNLOAD_MAX_BYTES), signal)).data.toString('utf8');
}

export async function fetchImage(url: string, signal: AbortSignal): Promise<{ data: string; mimeType: string }> {
  const image = await mediaFetcher.get(url, specification(url, IMAGE_DOWNLOAD_MAX_BYTES, IMAGE_TYPES), signal);
  return { data: image.data.toString('base64'), mimeType: image.type === 'image/jpg' ? 'image/jpeg' : image.type };
}

function run(command: string, args: readonly string[], signal: AbortSignal, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk: Buffer) => { out = `${out}${chunk.toString('utf8')}`.slice(-100_000); });
    child.stderr.on('data', (chunk: Buffer) => { err = `${err}${chunk.toString('utf8')}`.slice(-2_000); });
    child.on('error', (cause) => reject(new MediaError(`${command} 没起来（服务器上装了吗？）`, { cause })));
    child.on('close', (code) => {
      if (code === 0) {
        resolve(out);
      } else {
        const last = err.trim().split('\n').at(-1)?.replace(/https?:\/\/\S+/g, '<链接>').slice(0, 200) ?? '';
        reject(new MediaError(`${command} 没做成（退出码 ${String(code)}）：${last}`));
      }
    });
  });
}

/** 从本次解析下载的文件截一张关键帧，不重新联网。 */
export async function extractFrame(input: string, seconds: number, signal: AbortSignal):
  Promise<{ data: string; mimeType: string }> {
  const output = `${input}.frame.jpg`;
  try {
    await run('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', '-ss', String(seconds), '-i', input,
      '-frames:v', '1', '-vf', 'scale=960:-2', '-q:v', '3', output], signal, FFMPEG_TIMEOUT_MS);
    return { data: (await readFile(output)).toString('base64'), mimeType: 'image/jpeg' };
  } finally {
    await rm(output, { force: true });
  }
}

/** 抽成 16kHz 单声道 16 位 wav（transcribe.py 要的样子）。回音频秒数（ffprobe 读不到就是 null）。 */
export async function extractAudio(input: string, output: string, signal: AbortSignal): Promise<number | null> {
  await run('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', '-i', input, '-vn', '-ac', '1', '-ar', '16000',
    '-sample_fmt', 's16', output], signal, FFMPEG_TIMEOUT_MS);
  try {
    const probe = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', output],
      signal, FFMPEG_TIMEOUT_MS);
    const seconds = Number(probe.trim());
    return Number.isFinite(seconds) ? seconds : null;
  } catch (cause) {
    if (cause instanceof MediaError) {
      return null;
    }
    throw cause;
  }
}

export interface WebVideo {
  video: string | null;
  subtitles: { path: string; format: 'srt' | 'vtt' }[];
  title: string | null;
  caption: string;
  durationSeconds: number | null;
  author: string | null;
}

/** 别的网站：yt-dlp 先取字幕和信息，只下音频（省流量）。直链的媒体文件直接下。 */
export async function fetchWebVideo(url: string, directory: string, signal: AbortSignal): Promise<WebVideo> {
  await mkdir(directory, { recursive: true });
  if (/\.(mp4|m4a|mp3|webm|mov|m4v|wav)$/i.test(new URL(url).pathname)) {
    const file = join(directory, `media${extname(new URL(url).pathname)}`);
    await downloadTo(url, file, signal);
    return { video: file, subtitles: [], title: null, caption: '', durationSeconds: null, author: null };
  }
  const info = await run('yt-dlp', ['--no-playlist', '--no-progress', '--write-subs', '--write-auto-subs',
    '--sub-langs', 'zh.*,en.*', '--sub-format', 'vtt/srt', '-f', 'ba/b', '--max-filesize', '600M',
    '--print-json', '-o', join(directory, 'media.%(ext)s'), url], signal, YT_DLP_TIMEOUT_MS);
  const meta = parseInfo(info);
  const files = await readdir(directory);
  const subtitles = files.filter((name) => /\.(vtt|srt)$/.test(name))
    .map((name) => ({ path: join(directory, name), format: name.endsWith('.srt') ? 'srt' as const : 'vtt' as const }));
  const media = files.find((name) => name.startsWith('media.') && !/\.(vtt|srt|json|part)$/.test(name));
  return { ...meta, video: media === undefined ? null : join(directory, media), subtitles };
}

function parseInfo(text: string): Omit<WebVideo, 'video' | 'subtitles'> {
  const line = text.trim().split('\n').at(-1) ?? '{}';
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (cause) {
    throw new MediaError('yt-dlp 的输出读不懂。', { cause });
  }
  const info = typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {};
  const string = (key: string): string | null => (typeof info[key] === 'string' ? info[key] : null);
  const duration = info['duration'];
  return { title: string('title'), caption: string('description') ?? '', author: string('uploader'),
    durationSeconds: typeof duration === 'number' ? duration : null };
}

export async function readFileText(path: string): Promise<string> {
  return readFile(path, 'utf8');
}
