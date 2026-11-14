// 本地转写组件的转写（第13批）：直接跑 sherpa-onnx 的 sherpa-onnx-vad-with-offline-asr（VAD 按停顿切段 + SenseVoice），
// 不用 Python。它每一段打一行「开始 -- 结束: 文字」到标准输出，这里读成带时间的句子。一次只转一条（转写锁在 worker 里）。

import { spawn } from 'node:child_process';
import type { TranscriptLine } from './subtitles.ts';
import type { TranscribeResult, Transcriber } from './transcriber.ts';

/** 转写一次最多等这么久（SenseVoice 在 2 核上 10 分钟的视频约 1 分钟）。 */
const SHERPA_TIMEOUT_MS = 30 * 60 * 1000;
const OUTPUT_MAX_CHARS = 16 * 1024 * 1024;

export interface SherpaFiles {
  binary: string;
  model: string;
  tokens: string;
  vad: string;
}

/** 标准输出 → 句子。认不出的行不要（程序有时会多打一两行别的）。 */
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

/** 出错时标准错误里最有用的一行：带 Error / error / 不存在的那行，没有就最后一行；去掉编译机上的源码路径。 */
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

  /** 音频秒数不在输出里，由抽音频那一步给（pipeline 用 wav 的长度）。 */
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
