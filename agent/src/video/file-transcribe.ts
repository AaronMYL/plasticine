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
  tempRoot: string;
}

export interface FileTranscript {
  text: string;
  seconds: number | null;
  engine: string;
  coverage: string;
  leveled: boolean;
  stats: Coverage;
}

export const NO_TRANSCRIBER = '本地转写还没装：到「设置 · AI」的「本地转写」装好（几百 MB，装一次），再转。';

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
    await rm(dir, { recursive: true, force: true });
  }
}
