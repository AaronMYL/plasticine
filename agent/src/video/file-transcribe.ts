// 转一个音频或视频文件成文字（11-16 能力总表「音频转文字」）：文件页里的录音、下载下来的视频，和视频解析用同一个
// 本地转写（SenseVoice / faster-whisper）、同一把锁（小机器上一次只转一条）。先用 ffmpeg 抽成 16kHz 单声道 wav。

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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
}

export const NO_TRANSCRIBER = '本地转写还没装：到「设置 · AI」的「本地转写」装好（几百 MB，装一次），再转。';

export async function transcribeFile(ports: FileTranscribePorts, input: { data: Buffer; extension: string },
  signal: AbortSignal): Promise<FileTranscript> {
  const transcriber = ports.transcriber();
  if (transcriber === null) {
    throw new Error(NO_TRANSCRIBER);
  }
  const dir = await mkdtemp(join(ports.tempRoot, 'file-'));
  try {
    const source = join(dir, `in.${input.extension}`);
    const wav = join(dir, 'audio.wav');
    await writeFile(source, input.data);
    const seconds = await extractAudio(source, wav, signal, ports.ffmpeg());
    const result = await ports.whileTranscribing(() => transcriber.transcribe(wav, signal));
    return { text: transcriptText(result.lines), seconds: result.audioSeconds ?? seconds, engine: result.engine };
  } finally {
    // 这次自己建的临时目录，用完就清。
    await rm(dir, { recursive: true, force: true });
  }
}
