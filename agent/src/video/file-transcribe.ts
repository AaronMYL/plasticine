// 转一个音频或视频文件成文字（11-16 能力总表「音频转文字」）：文件页里的录音、下载下来的视频，和视频解析用同一个
// 本地转写（SenseVoice / faster-whisper）、同一把锁（小机器上一次只转一条）。先用 ffmpeg 抽成 16kHz 单声道 wav。

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { coverageOf, coverageText, type Coverage, type Leveling } from './leveling.ts';
import { extractAudio } from './media.ts';
import { transcriptText } from './subtitles.ts';
import type { Transcriber } from './transcriber.ts';

export interface FileTranscribePorts {
  transcriber: () => Transcriber | null;
  ffmpeg: () => string;
  whileTranscribing: <T>(work: () => Promise<T>) => Promise<T>;
  /** 临时目录放在哪下面（状态目录里的 video-work/）。 */
  tempRoot: string;
}

export interface FileTranscript {
  /** 带时间的逐字稿：「[00:12] 一句话」一行一句。 */
  text: string;
  seconds: number | null;
  engine: string;
  /** 这次拉没拉平音量、转出来多少（11-18，leveling.ts）：一句给模型看的话，和数。 */
  coverage: string;
  leveled: boolean;
  stats: Coverage;
}

export const NO_TRANSCRIBER = '本地转写还没装：到「设置 · AI」的「本地转写」装好（几百 MB，装一次），再转。';

/** 文件页里的录音、视频默认 auto：先量音量，太轻才拉平（11-18 Aaron 定）。 */
export async function transcribeFile(ports: FileTranscribePorts,
  input: { data: Buffer; extension: string; leveling?: Leveling }, signal: AbortSignal): Promise<FileTranscript> {
  const transcriber = ports.transcriber();
  if (transcriber === null) {
    throw new Error(NO_TRANSCRIBER);
  }
  const dir = await mkdtemp(join(ports.tempRoot, 'file-'));
  try {
    const source = join(dir, `in.${input.extension}`);
    const wav = join(dir, 'audio.wav');
    await writeFile(source, input.data);
    const audio = await extractAudio(source, wav, signal, ports.ffmpeg(), input.leveling ?? 'auto');
    const result = await ports.whileTranscribing(() => transcriber.transcribe(wav, signal));
    const seconds = result.audioSeconds ?? audio.seconds;
    const stats = coverageOf(result.lines.map((line) => line.start), seconds);
    return { text: transcriptText(result.lines), seconds, engine: result.engine, leveled: audio.leveled, stats,
      coverage: coverageText(stats, audio.leveled) };
  } finally {
    // 这次自己建的临时目录，用完就清。
    await rm(dir, { recursive: true, force: true });
  }
}
