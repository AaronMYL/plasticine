// 一条作品往前走（《优化清单》第 9 条；11-09 他定「这种就直接转」）：已同步 → 已转写 → 已总结。
//   1. 取内容：抖音的下载地址要 Mac 取（没取到就排给 Mac，这一条停在「等 Mac」，Mac 交回再接着走）；
//      别的网站交给 yt-dlp，直链直接下。不再先拿标题和配文预览（「已预览」只留在旧数据里）。
//   2. 图文：读每张图里的文字，结合配文总结。抖音视频：不看标题、配文和自带字幕，直接下载、抽音频、本地转写
//      （一次只转一条）。别的网站的视频照旧先用自带字幕，没有再本地转写。
//   3. 总结：逐字稿 + 大纲、核心观点、和他兴趣有关的重点。
// 每一步写进库再走下一步，进程重启后从停下的那一步接着走；临时文件做完就删。

import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { VIDEO_IMAGES_MAX, type DouyinResolved, type VideoDigest } from '../../shared/api/video.ts';
import type { TextImage } from '../kernel/index.ts';
import type { VideoWorkRow, VideoWorkStore } from '../state/index.ts';
import type { DigestInput, VideoDigester } from './digest.ts';
import type { WebVideo } from './media.ts';
import { parseSubtitle, transcriptText, type TranscriptLine } from './subtitles.ts';
import type { Transcriber } from './transcriber.ts';
import { outlineTime } from './space-report.ts';

/** 下载、抽音频、读字幕这些碰网络和文件的事，测试给假的。 */
export interface VideoMedia {
  download(url: string, file: string, signal: AbortSignal): Promise<number>;
  extractFrame?(input: string, seconds: number, signal: AbortSignal): Promise<TextImage>;
  extractAudio(input: string, output: string, signal: AbortSignal): Promise<number | null>;
  fetchText(url: string, signal: AbortSignal): Promise<string>;
  fetchImage(url: string, signal: AbortSignal): Promise<TextImage>;
  readText(path: string): Promise<string>;
  webVideo(url: string, directory: string, signal: AbortSignal): Promise<WebVideo>;
}

export interface PipelinePorts {
  works: Pick<VideoWorkStore, 'require' | 'advance'>;
  media: VideoMedia;
  digester: VideoDigester;
  /** 没配本地转写就是 null：没有自带字幕的视频记「这台机器还没装转写」。 */
  transcriber: Transcriber | null;
  /** 转写一次只跑一条（2 核机器）：拿到这把锁再转。 */
  transcribeLock: <T>(work: () => Promise<T>) => Promise<T>;
  interests: () => string[];
  /** 抖音作品还没有下载地址：排给 Mac。 */
  askMac: (work: VideoWorkRow) => void;
  tempRoot: string;
  now: () => number;
  saveImage?: (image: TextImage) => string;
  publish?: (work: VideoWorkRow) => void;
}

/** 走到哪停下了：summarized 做完、waiting_mac 等 Mac 交下载地址。 */
export type PipelineEnd = 'summarized' | 'waiting_mac';

export const NO_TRANSCRIBER_TEXT = '这台机器还没装本地转写，转不了这条（见 docs/specs/video-parse.md）。';

function inputOf(work: VideoWorkRow, interests: readonly string[]): DigestInput {
  return { title: work.title, caption: work.caption, author: work.author, interests };
}

export async function advanceWork(id: string, ports: PipelinePorts, signal: AbortSignal): Promise<PipelineEnd> {
  let work = ports.works.require(id);
  if (work.stage === 'summarized') {
    if (work.spaceId === null) ports.publish?.(work);
    return 'summarized';
  }
  const directory = await mkdtemp(join(ports.tempRoot, 'work-'));
  try {
    let media: string | null = null;
    if (work.stage !== 'transcribed') {
      if (work.platform === 'douyin' && work.resolved === null) {
        ports.askMac(work);
        return 'waiting_mac';
      }
      media = work.platform === 'douyin'
        ? await fromDouyin(work, work.resolved!, directory, ports, signal)
        : await fromWeb(work, directory, ports, signal);
      work = ports.works.require(id);
    }
    const digest = work.digest ?? await ports.digester.summarize({ ...inputOf(work, ports.interests()),
      transcript: work.transcript ?? '' }, signal);
    const images = media === null ? digest.images : await keyFrames(work, digest, media, ports, signal);
    ports.works.advance(id, { stage: 'summarized', digest: { ...digest,
      ...(images === undefined ? {} : { images }) } });
    ports.publish?.(ports.works.require(id));
    return 'summarized';
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** 只从已经下载的原视频截帧；最多四张，沿用报告设计里的关键时刻。 */
async function keyFrames(work: VideoWorkRow, digest: VideoDigest, file: string, ports: PipelinePorts,
  signal: AbortSignal): Promise<VideoDigest['images']> {
  if (ports.media.extractFrame === undefined || ports.saveImage === undefined) return undefined;
  const positions = [...new Set(digest.outline.flatMap((line) => {
    const time = outlineTime(line);
    return time === null || (work.durationSeconds !== null && time.seconds >= work.durationSeconds)
      ? [] : [time.seconds];
  }))].slice(0, 4);
  const images: NonNullable<VideoDigest['images']> = [];
  for (const seconds of positions) {
    const image = await ports.media.extractFrame(file, seconds, signal);
    images.push({ asset: ports.saveImage(image), seconds });
  }
  return images;
}

async function fromDouyin(work: VideoWorkRow, resolved: DouyinResolved, directory: string, ports: PipelinePorts,
  signal: AbortSignal): Promise<string | null> {
  const caption = resolved.caption === '' ? work.caption : resolved.caption;
  ports.works.advance(work.id, { kind: resolved.kind, caption, durationSeconds: resolved.durationSeconds });
  if (resolved.kind === 'images') {
    const images: TextImage[] = [];
    for (const url of resolved.images.slice(0, VIDEO_IMAGES_MAX)) {
      images.push(await ports.media.fetchImage(url, signal));
    }
    const read = await ports.digester.readImages({ ...inputOf({ ...work, caption }, ports.interests()), images },
      signal);
    const { transcript, ...digest } = read;
    const assets = ports.saveImage === undefined ? undefined
      : images.map((image) => ({ asset: ports.saveImage!(image), seconds: null }));
    ports.works.advance(work.id, { stage: 'transcribed', transcript, transcriptSource: 'images',
      digest: { ...digest, ...(assets === undefined ? {} : { images: assets }) } });
    return null;
  }
  if (resolved.videoUrl === null) {
    throw new Error('Mac 没取到这条的视频地址。');
  }
  const started = ports.now();
  const file = join(directory, 'video.mp4');
  await ports.media.download(resolved.videoUrl, file, signal);
  await localTranscript(work, file, directory, ports, signal, ports.now() - started);
  return file;
}

async function fromWeb(work: VideoWorkRow, directory: string, ports: PipelinePorts, signal: AbortSignal):
  Promise<string | null> {
  const started = ports.now();
  const web = await ports.media.webVideo(work.url, directory, signal);
  const downloadMs = ports.now() - started;
  ports.works.advance(work.id, { kind: 'video', caption: web.caption.slice(0, 5_000),
    durationSeconds: web.durationSeconds });
  for (const subtitle of web.subtitles) {
    const lines = parseSubtitle(await ports.media.readText(subtitle.path), subtitle.format);
    if (lines.length > 0) {
      ports.works.advance(work.id, { stage: 'transcribed', transcript: transcriptText(lines),
        transcriptSource: 'subtitle' });
      return web.video;
    }
  }
  if (web.video === null) {
    throw new Error('这个链接里没找到能下载的视频或音频。');
  }
  await localTranscript(work, web.video, directory, ports, signal, downloadMs);
  return web.video;
}

async function localTranscript(work: VideoWorkRow, media: string, directory: string, ports: PipelinePorts,
  signal: AbortSignal, downloadMs: number): Promise<void> {
  const transcriber = ports.transcriber;
  if (transcriber === null) {
    throw new Error(NO_TRANSCRIBER_TEXT);
  }
  const audio = join(directory, 'audio.wav');
  const seconds = await ports.media.extractAudio(media, audio, signal);
  const result = await ports.transcribeLock(async () => {
    const started = ports.now();
    const done = await transcriber.transcribe(audio, signal);
    return { done, ms: ports.now() - started };
  });
  const lines: TranscriptLine[] = result.done.lines;
  if (lines.length === 0) {
    throw new Error('转写出来是空的（可能只有音乐、没有人声）。');
  }
  ports.works.advance(work.id, {
    stage: 'transcribed',
    transcript: transcriptText(lines),
    transcriptSource: 'local',
    timing: { engine: transcriber.name, downloadMs, transcribeMs: result.ms, peakMb: result.done.peakMb,
      audioSeconds: result.done.audioSeconds ?? seconds },
  });
}
