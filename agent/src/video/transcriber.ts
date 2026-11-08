// 本地转写（《优化清单》第 9 条）：在本体所在的机器上转写，不用按分钟收费的云端转写。转写引擎是可替换的一层：
// 现在接 SenseVoice（sherpa-onnx 的 int8 模型，CPU 上快、中文准）或 faster-whisper（int8，多语种），由服务器上的
// transcribe.py 跑，回 JSON。装法、模型大小、实测见 docs/specs/video-parse.md。
// 2 核 4G 的机器上转写一次只跑一条（TRANSCRIBE_AT_ONCE），别的排着。

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import type { TranscriptLine } from './subtitles.ts';

export const TRANSCRIBE_ENGINES = ['sensevoice', 'faster-whisper'] as const;
export type TranscribeEngine = (typeof TRANSCRIBE_ENGINES)[number];

/** 转写一次最多等这么久：10 分钟的视频在 2 核上 SenseVoice 约 1 分钟、faster-whisper small 约 10 分钟。 */
const TRANSCRIBE_TIMEOUT_MS = 30 * 60 * 1000;
/** 进程输出最多收这么多（逐字稿 JSON）。 */
const OUTPUT_MAX_BYTES = 16 * 1024 * 1024;

export interface TranscribeResult {
  lines: TranscriptLine[];
  /** 音频多长（秒）。 */
  audioSeconds: number | null;
  /** 转写进程的峰值内存（MB）。 */
  peakMb: number | null;
  engine: string;
}

export interface Transcriber {
  readonly name: string;
  transcribe(audioPath: string, signal: AbortSignal): Promise<TranscribeResult>;
}

const OutputSchema = Type.Object({
  engine: Type.String(),
  audioSeconds: Type.Union([Type.Number(), Type.Null()]),
  peakMb: Type.Union([Type.Number(), Type.Null()]),
  segments: Type.Array(Type.Object({ start: Type.Number(), text: Type.String() })),
});

export const TRANSCRIBE_SCRIPT = fileURLToPath(new URL('./transcribe.py', import.meta.url));

export interface CommandTranscriberOptions {
  engine: TranscribeEngine;
  /** 模型目录（SenseVoice）或模型名 / 目录（faster-whisper）。 */
  model: string;
  python?: string;
  threads?: number;
}

/** 跑 transcribe.py：一次一条，结果是 JSON。 */
export class CommandTranscriber implements Transcriber {
  readonly name: string;
  readonly #options: CommandTranscriberOptions;

  constructor(options: CommandTranscriberOptions) {
    this.#options = options;
    this.name = `${options.engine}:${options.model.split('/').at(-1) ?? options.model}`;
  }

  transcribe(audioPath: string, signal: AbortSignal): Promise<TranscribeResult> {
    const args = [TRANSCRIBE_SCRIPT, '--engine', this.#options.engine, '--model', this.#options.model,
      '--threads', String(this.#options.threads ?? 2), audioPath];
    return new Promise((resolve, reject) => {
      const child = spawn(this.#options.python ?? 'python3', args, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS)]),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const out: Buffer[] = [];
      let size = 0;
      let errText = '';
      child.stdout.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size <= OUTPUT_MAX_BYTES) {
          out.push(chunk);
        }
      });
      child.stderr.on('data', (chunk: Buffer) => {
        errText = `${errText}${chunk.toString('utf8')}`.slice(-2_000);
      });
      child.on('error', (cause) => reject(new Error(`转写进程没起来：${cause.message}`, { cause })));
      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`转写失败（退出码 ${String(code)}）：${lastLine(errText)}`));
          return;
        }
        try {
          resolve(resultOf(Buffer.concat(out).toString('utf8')));
        } catch (cause) {
          reject(cause instanceof Error ? cause : new Error(String(cause)));
        }
      });
    });
  }
}

function lastLine(text: string): string {
  return text.trim().split('\n').at(-1)?.slice(0, 300) ?? '没有输出';
}

export function resultOf(stdout: string): TranscribeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (cause) {
    throw new Error('转写结果不是 JSON。', { cause });
  }
  if (!Value.Check(OutputSchema, parsed)) {
    throw new Error('转写结果的格式不对。');
  }
  return { lines: parsed.segments.filter((line) => line.text.trim() !== ''), audioSeconds: parsed.audioSeconds,
    peakMb: parsed.peakMb, engine: parsed.engine };
}

/** 服务器上的设置（环境变量，部署时写进 systemd 单元）：没配就没有本地转写，只用自带字幕。 */
export function transcriberFromEnv(env: NodeJS.ProcessEnv): Transcriber | null {
  const engine = TRANSCRIBE_ENGINES.find((name) => name === env['PLASTICINE_TRANSCRIBE_ENGINE']);
  const model = env['PLASTICINE_TRANSCRIBE_MODEL'];
  if (engine === undefined || model === undefined || model === '') {
    return null;
  }
  const threads = Number(env['PLASTICINE_TRANSCRIBE_THREADS'] ?? '2');
  return new CommandTranscriber({ engine, model, threads: Number.isFinite(threads) && threads > 0 ? threads : 2,
    ...(env['PLASTICINE_PYTHON'] === undefined ? {} : { python: env['PLASTICINE_PYTHON'] }) });
}
