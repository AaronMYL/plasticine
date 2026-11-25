import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { VIDEO_IMAGES_MAX, type DouyinResolved, type VideoDigest } from '../../shared/api/video.ts';
import type { TextImage } from '../kernel/index.ts';
import type { VideoWorkRow, VideoWorkStore } from '../state/index.ts';
import type { DigestInput, VideoDigester } from './digest.ts';
import type { Leveling } from './leveling.ts';
import type { ExtractedAudio, WebVideo } from './media.ts';
import { parseSubtitle, transcriptText, type TranscriptLine } from './subtitles.ts';
import type { Transcriber } from './transcriber.ts';
import { outlineTime } from '../../shared/video-space-page.ts';

export interface VideoMedia {
  download(url: string, file: string, signal: AbortSignal): Promise<number>;
  extractFrame?(input: string, seconds: number, signal: AbortSignal): Promise<TextImage>;
  extractAudio(input: string, output: string, signal: AbortSignal, leveling: Leveling): Promise<ExtractedAudio>;
  fetchText(url: string, signal: AbortSignal): Promise<string>;
  fetchImage(url: string, signal: AbortSignal): Promise<TextImage>;
  readText(path: string): Promise<string>;
  webVideo(url: string, directory: string, signal: AbortSignal): Promise<WebVideo>;
}

export interface PipelinePorts {
  works: Pick<VideoWorkStore, 'require' | 'advance'>;
  media: VideoMedia;
  digester: VideoDigester;
  transcriber: () => Transcriber | null;
  transcribeLock: <T>(work: () => Promise<T>) => Promise<T>;
  interests: () => string[];
  askMac: (work: VideoWorkRow) => void;
  tempRoot: string;
  now: () => number;
  saveImage?: (image: TextImage) => string;
  publish?: (work: VideoWorkRow) => void;
  leveling?: (work: VideoWorkRow) => Leveling | undefined;
}

export function defaultLeveling(work: Pick<VideoWorkRow, 'platform'>): Leveling {
  return work.platform === 'douyin' ? 'off' : 'auto';
}

export type PipelineEnd = 'summarized' | 'waiting_mac' | 'waiting_transcriber';

class NeedsTranscriber extends Error {}

function douyinVideo(work: VideoWorkRow): boolean {
  return work.platform === 'douyin' && (work.resolved?.kind ?? work.kind) === 'video';
}

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
      if (douyinVideo(work) && ports.transcriber() === null) {
        return 'waiting_transcriber';
      }
      if (work.platform === 'douyin' && work.resolved === null) {
        ports.askMac(work);
        return 'waiting_mac';
      }
      try {
        media = work.platform === 'douyin'
          ? await fromDouyin(work, work.resolved!, directory, ports, signal)
          : await fromWeb(work, directory, ports, signal);
      } catch (cause) {
        if (cause instanceof NeedsTranscriber) return 'waiting_transcriber';
        throw cause;
      }
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
    throw new Error('电脑上没取到这条的视频地址。');
  }
  if (ports.transcriber() === null) {
    throw new NeedsTranscriber();
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
  const transcriber = ports.transcriber();
  if (transcriber === null) {
    throw new NeedsTranscriber();
  }
  const audio = join(directory, 'audio.wav');
  const extracted = await ports.media.extractAudio(media, audio, signal,
    ports.leveling?.(work) ?? defaultLeveling(work));
  const seconds = extracted.seconds;
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
      audioSeconds: result.done.audioSeconds ?? seconds, leveled: extracted.leveled },
  });
}
