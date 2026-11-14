// 来信配图存之前压小（第13批，11-14 Aaron 弹框选「压小」）：订阅那一路 OpenAI 出的图不压缩（实测 1672×941、约
// 2.4 MB，手机上打开来信慢），存之前转成最宽 1200 的 webp。用已有的 ffmpeg（转写组件里的，没装组件就用系统里的），
// 没有 ffmpeg、转不成、转完反而更大，都照原图存——不加新依赖，也不因为压不小就不配图。

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { safeLog } from '../shared-log.ts';
import type { Illustration, IllustrationMime, Illustrator } from './images.ts';

/** 来信信纸外扩到 720 宽，两倍屏也够清楚。 */
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

/** 转成最宽 1200 的 webp；转不成或没变小就回原图（原因记进日志）。 */
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
    // 这次自己建的临时目录，用完就清。
    await rm(dir, { recursive: true, force: true });
  }
}

/** 包在出图外面：画出来的先压小再交出去；画不出来的原样回原因。 */
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
