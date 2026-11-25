import { spawn } from 'node:child_process';
import type { TranscriptLine } from './subtitles.ts';
import type { TranscribeResult, Transcriber } from './transcriber.ts';

const SHERPA_TIMEOUT_MS = 30 * 60 * 1000;
const OUTPUT_MAX_CHARS = 16 * 1024 * 1024;

export interface SherpaFiles {
  binary: string;
  model: string;
  tokens: string;
  vad: string;
}

export function sherpaLines(stdout: string): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  for (const raw of stdout.split('\n')) {
    const match = /^\s*(\d+(?:\.\d+)?)\s*--\s*\d+(?:\.\d+)?\s*:\s?(.*)$/u.exec(raw);
    const text = match?.[2]?.trim() ?? '';
    if (match !== null && text !== '') {
      lines.push({ start: Number(match[1]), text });
    }
  }
  return lines;
}

export function sherpaFailure(stderr: string): string {
  const lines = stderr.split('\n').map((line) => line.trim()).filter((line) => line !== '');
  const line = lines.find((entry) => /error|does not exist|failed/i.test(entry)) ?? lines.at(-1) ?? '没有输出';
  return line.replace(/^\S*\/csrc\/\S+\s*/u, '').slice(0, 200);
}

export class SherpaTranscriber implements Transcriber {
  readonly name = 'sensevoice:kit';
  readonly #files: SherpaFiles;
  readonly #threads: number;

  constructor(files: SherpaFiles, threads = 2) {
    this.#files = files;
    this.#threads = threads;
  }

  transcribe(audioPath: string, signal: AbortSignal): Promise<TranscribeResult> {
    const args = [`--silero-vad-model=${this.#files.vad}`, `--tokens=${this.#files.tokens}`,
      `--sense-voice-model=${this.#files.model}`, '--sense-voice-language=auto', '--sense-voice-use-itn=true',
      `--num-threads=${String(this.#threads)}`, '--silero-vad-min-silence-duration=0.4',
      '--silero-vad-max-speech-duration=20', audioPath];
    return new Promise((resolve, reject) => {
      const child = spawn(this.#files.binary, args, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(SHERPA_TIMEOUT_MS)]),
        stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      });
      let out = '';
      let err = '';
      child.stdout.on('data', (chunk: Buffer) => {
        if (out.length < OUTPUT_MAX_CHARS) out += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk: Buffer) => { err = `${err}${chunk.toString('utf8')}`.slice(-4_000); });
      child.on('error', (cause) => reject(new Error(`本地转写没起来：${cause.message}`, { cause })));
      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`本地转写没做成（退出码 ${String(code)}）：${sherpaFailure(err)}`));
          return;
        }
        resolve({ lines: sherpaLines(out), audioSeconds: null, peakMb: null, engine: 'sensevoice' });
      });
    });
  }
}
