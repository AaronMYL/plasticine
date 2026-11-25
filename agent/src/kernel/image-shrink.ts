import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { safeLog } from '../util/index.ts';
import type { Illustration, IllustrationMime, Illustrator } from './images.ts';

export const SHRINK_MAX_WIDTH = 1200;
const SHRINK_QUALITY = 80;
const SHRINK_TIMEOUT_MS = 30_000;
const EXTENSIONS: Readonly<Record<IllustrationMime, string>> = {
  'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg',
};

export type Shrunk = { data: Buffer; mime: IllustrationMime };
export type ShrinkFn = (data: Buffer, mime: IllustrationMime, ffmpeg: string, signal: AbortSignal) => Promise<Shrunk>;

function run(command: string, args: readonly string[], signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { signal: AbortSignal.any([signal, AbortSignal.timeout(SHRINK_TIMEOUT_MS)]),
      stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let err = '';
    child.stderr.on('data', (chunk: Buffer) => { err = `${err}${chunk.toString('utf8')}`.slice(-500); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg 退出码 ${String(code)}：${err.trim().split('\n').at(-1) ?? ''}`));
    });
  });
}

export async function shrinkIllustration(data: Buffer, mime: IllustrationMime, ffmpeg: string,
  signal: AbortSignal): Promise<Shrunk> {
  const dir = await mkdtemp(join(tmpdir(), 'plasticine-illustration-'));
  try {
    const input = join(dir, `in.${EXTENSIONS[mime]}`);
    const output = join(dir, 'out.webp');
    await writeFile(input, data);
    await run(ffmpeg, ['-nostdin', '-loglevel', 'error', '-y', '-i', input,
      '-vf', `scale='min(${String(SHRINK_MAX_WIDTH)},iw)':-2`, '-c:v', 'libwebp', '-quality', String(SHRINK_QUALITY),
      output], signal);
    const smaller = await readFile(output);
    return smaller.length > 0 && smaller.length < data.length ? { data: smaller, mime: 'image/webp' } : { data, mime };
  } catch (error) {
    if (signal.aborted) throw error;
    safeLog('log', 'illustration_shrink_skipped', { error });
    return { data, mime };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export class ShrinkingIllustrator implements Illustrator {
  readonly #inner: Illustrator;
  readonly #ffmpeg: () => string;
  readonly #shrink: ShrinkFn;

  constructor(inner: Illustrator, ffmpeg: () => string, shrink: ShrinkFn = shrinkIllustration) {
    this.#inner = inner;
    this.#ffmpeg = ffmpeg;
    this.#shrink = shrink;
  }

  async draw(prompt: string, signal: AbortSignal): Promise<Illustration> {
    const drawn = await this.#inner.draw(prompt, signal);
    if ('error' in drawn) return drawn;
    return this.#shrink(drawn.data, drawn.mime, this.#ffmpeg(), signal);
  }
}
