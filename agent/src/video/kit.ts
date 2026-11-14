// 本地转写组件（第13批，11-14 Aaron：「第一次用时问一句再下载」）：没装时视频不下载，界面出一张卡问他装不装；点了在后台
// 下（有进度）、按 sha256 核对、解开、试转一段静音，都好了才算装好，在等转写的作品接着走。服务器上用环境变量自己配的转写
// 照旧优先（Aaron 那台就是）。装在数据目录的 components/transcribe 里，不进安装包；下坏了、断了，下次点安装从没下完的那份接着来。

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, readFileSync } from 'node:fs';
import { chmod, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import type { TranscriberStatus } from '../../shared/api/video.ts';
import { PublicFetcher, PublicFetchError } from '../cloud-tools/index.ts';
import { safeLog } from '../shared-log.ts';
import { KIT_VERSION, kitBytes, type KitFile, type KitPlan } from './kit-files.ts';
import { silentWav } from './wav.ts';
import { SherpaTranscriber } from './sherpa.ts';
import type { Transcriber } from './transcriber.ts';

/** 一个文件最多下这么久（模型 160 MB，慢的线路也够）。 */
const KIT_DOWNLOAD_TIMEOUT_MS = 60 * 60 * 1000;
/** 进度最多这么久报一次。 */
const PROGRESS_EVERY_MS = 500;
const TOOL_TIMEOUT_MS = 2 * 60 * 1000;
const AGENT = 'Plasticine (transcriber kit)';

export interface KitPorts {
  /** 下到 file，每收到一块报一下多少字节。 */
  download(url: string, file: string, signal: AbortSignal, bytes: (count: number) => void): Promise<void>;
  /** 解 tar.bz2 里的几项到 into。 */
  untar(archive: string, into: string, members: readonly string[], signal: AbortSignal): Promise<void>;
  /** 装好以后试一下：转写一段静音、ffmpeg 能跑。不行就抛出原因。 */
  check(transcriber: Transcriber, ffmpeg: string, scratch: string, signal: AbortSignal): Promise<void>;
}

export interface KitOptions {
  /** 数据目录里的 components。 */
  directory: string;
  plan: KitPlan | null;
  /** 环境变量配的转写（优先）。 */
  env: Transcriber | null;
  changed: (status: TranscriberStatus) => void;
  ports?: Partial<KitPorts>;
  threads?: number;
}

class KitError extends Error {}

const fetcher = new PublicFetcher();

function run(command: string, args: readonly string[], signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { signal: AbortSignal.any([signal, AbortSignal.timeout(TOOL_TIMEOUT_MS)]),
      stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let err = '';
    child.stderr.on('data', (chunk: Buffer) => { err = `${err}${chunk.toString('utf8')}`.slice(-1_000); });
    child.on('error', (cause) => reject(cause));
    child.on('close', (code) => code === 0 ? resolve()
      : reject(new KitError(`${command} 没做成（退出码 ${String(code)}）：${err.trim().split('\n').at(-1) ?? ''}`)));
  });
}

export const REAL_KIT_PORTS: KitPorts = {
  async download(url, file, signal, bytes) {
    await fetcher.read(url, { accept: '*/*', types: null, maxBytes: 1024 * 1024 * 1024, userAgent: AGENT,
      timeoutMs: KIT_DOWNLOAD_TIMEOUT_MS }, signal, async (chunks) => {
      const counted = async function* (): AsyncGenerator<Buffer> {
        for await (const chunk of chunks) { bytes(chunk.length); yield chunk; }
      };
      await pipeline(Readable.from(counted()), createWriteStream(file), { signal });
    });
  },
  untar: (archive, into, members, signal) => run('tar', ['-xjf', archive, '-C', into, ...members], signal),
  async check(transcriber, ffmpeg, scratch, signal) {
    const wav = join(scratch, 'check.wav');
    await writeFile(wav, silentWav(1));
    try {
      await transcriber.transcribe(wav, signal);
      await run(ffmpeg, ['-hide_banner', '-version'], signal);
    } finally {
      await rm(wav, { force: true });
    }
  },
};

async function sha256(file: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

async function sameFile(file: string, expected: KitFile): Promise<boolean> {
  try {
    return (await stat(file)).size === expected.bytes && await sha256(file) === expected.sha256;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw cause;
  }
}

/** 没装成的原因，写成他看得懂的话。 */
export function kitFailure(cause: unknown): string {
  const code = (cause as NodeJS.ErrnoException | null)?.code;
  if (code === 'ENOSPC') return '磁盘空间不够：装本地转写要留出约 500 MB。';
  if (code === 'ENOENT' && (cause as NodeJS.ErrnoException).path === 'tar') {
    return '这台机器上没有 tar，解不开下载的压缩包。';
  }
  if (cause instanceof PublicFetchError) {
    return cause.code === 'timeout' ? '下载太慢，超时了。过一会儿再试。'
      : '下载没成功：连不上 GitHub（组件从 github.com 下载）。过一会儿再试。';
  }
  if (cause instanceof KitError) return cause.message;
  return `没装成：${cause instanceof Error ? cause.message : String(cause)}`.slice(0, 200);
}

export class TranscribeKit {
  readonly #root: string;
  readonly #partial: string;
  readonly #downloads: string;
  readonly #plan: KitPlan | null;
  readonly #env: Transcriber | null;
  readonly #changed: (status: TranscriberStatus) => void;
  readonly #ports: KitPorts;
  readonly #threads: number;
  #installed: boolean;
  #installing: AbortController | null = null;
  #running: Promise<void> | null = null;
  #done = 0;
  #step: 'download' | 'unpack' = 'download';
  #error: string | null = null;
  #reported = 0;

  constructor(options: KitOptions) {
    this.#root = join(options.directory, 'transcribe');
    this.#partial = join(options.directory, 'transcribe.partial');
    this.#downloads = join(options.directory, 'downloads');
    this.#plan = options.plan;
    this.#env = options.env;
    this.#changed = options.changed;
    this.#ports = { ...REAL_KIT_PORTS, ...options.ports };
    this.#threads = options.threads ?? Math.min(4, Math.max(2, availableParallelism() - 1));
    this.#installed = this.#readInstalled();
  }

  #readInstalled(): boolean {
    if (this.#plan === null) return false;
    try {
      const kit = JSON.parse(readFileSync(join(this.#root, 'kit.json'), 'utf8')) as { version?: unknown };
      return kit.version === KIT_VERSION && existsSync(join(this.#root, this.#plan.binary));
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return false;
      safeLog('warn', 'transcriber_kit_unreadable', { error: cause });
      return false;
    }
  }

  status(): TranscriberStatus {
    const totalBytes = kitBytes(this.#plan);
    const base = { totalBytes, doneBytes: 0, step: null, error: null };
    if (this.#env !== null) return { ...base, state: 'ready', source: 'env' };
    if (this.#installed) return { ...base, state: 'ready', source: 'kit', doneBytes: totalBytes };
    if (this.#plan === null) return { ...base, state: 'unsupported', source: null };
    if (this.#installing !== null) {
      return { ...base, state: 'installing', source: null, doneBytes: Math.min(this.#done, totalBytes),
        step: this.#step };
    }
    if (this.#error !== null) return { ...base, state: 'failed', source: null, error: this.#error };
    return { ...base, state: 'absent', source: null };
  }

  /** 能用的转写：环境变量配的优先，其次装好的组件；都没有是 null。 */
  transcriber(): Transcriber | null {
    if (this.#env !== null) return this.#env;
    return this.#installed && this.#plan !== null ? this.#sherpa(this.#root, this.#plan) : null;
  }

  /** 抽音频、截图用的 ffmpeg：装好的组件里的，没有就用系统里的。 */
  ffmpeg(): string {
    return this.#installed && this.#plan !== null ? join(this.#root, this.#plan.ffmpeg) : 'ffmpeg';
  }

  /** 开始装（后台）。装着、装好、用不上的不重来。 */
  install(): TranscriberStatus {
    if (this.#env === null && !this.#installed && this.#plan !== null && this.#installing === null) {
      const controller = new AbortController();
      this.#installing = controller;
      this.#done = 0;
      this.#step = 'download';
      this.#error = null;
      const plan = this.#plan;
      this.#running = this.#install(plan, controller.signal).then(() => {
        this.#installed = true;
      }, (cause: unknown) => {
        if (controller.signal.aborted) return;
        safeLog('warn', 'transcriber_kit_failed', { error: cause });
        this.#error = kitFailure(cause);
      }).finally(() => {
        this.#installing = null;
        this.#changed(this.status());
      });
    }
    return this.status();
  }

  /** 测试和关机用：等这一次装完。 */
  async settled(): Promise<void> {
    await this.#running;
  }

  async stop(): Promise<void> {
    this.#installing?.abort(new Error('服务停止，下次点安装接着下。'));
    await this.#running;
  }

  #sherpa(root: string, plan: KitPlan): Transcriber {
    return new SherpaTranscriber({ binary: join(root, plan.binary), model: join(root, plan.model),
      tokens: join(root, plan.tokens), vad: join(root, plan.vad) }, this.#threads);
  }

  #progress(force = false): void {
    const at = Date.now();
    if (!force && at - this.#reported < PROGRESS_EVERY_MS) return;
    this.#reported = at;
    this.#changed(this.status());
  }

  async #install(plan: KitPlan, signal: AbortSignal): Promise<void> {
    this.#progress(true);
    await mkdir(this.#downloads, { recursive: true, mode: 0o700 });
    for (const file of plan.files) {
      const target = join(this.#downloads, file.name);
      if (!await sameFile(target, file)) {
        const part = `${target}.part`;
        await rm(part, { force: true });
        await this.#ports.download(file.url, part, signal, (count) => {
          this.#done += count;
          this.#progress();
        });
        if (!await sameFile(part, file)) {
          await rm(part, { force: true });
          throw new KitError(`下载的「${file.name}」和发布页上的对不上（可能下坏了），没有装。再试一次。`);
        }
        await rename(part, target);
      } else {
        this.#done += file.bytes;
      }
    }
    this.#step = 'unpack';
    this.#progress(true);
    await rm(this.#partial, { recursive: true, force: true });
    await mkdir(this.#partial, { recursive: true, mode: 0o700 });
    for (const file of plan.files) {
      await this.#unpack(file, signal);
    }
    await this.#ports.check(this.#sherpa(this.#partial, plan), join(this.#partial, plan.ffmpeg), this.#partial, signal)
      .catch((cause: unknown) => {
        throw new KitError(`装好了但试转一段没成：${cause instanceof Error ? cause.message : String(cause)}`);
      });
    await writeFile(join(this.#partial, 'kit.json'), JSON.stringify({ version: KIT_VERSION }));
    await rm(this.#root, { recursive: true, force: true });
    await rename(this.#partial, this.#root);
    await rm(this.#downloads, { recursive: true, force: true });
  }

  async #unpack(file: KitFile, signal: AbortSignal): Promise<void> {
    const archive = join(this.#downloads, file.name);
    const unpack = file.unpack;
    if (unpack.kind === 'tar.bz2') {
      const into = join(this.#partial, file.into);
      await mkdir(into, { recursive: true });
      await this.#ports.untar(archive, into, unpack.members, signal);
      return;
    }
    const target = join(this.#partial, unpack.target);
    await mkdir(join(target, '..'), { recursive: true });
    if (unpack.kind === 'gz') {
      await pipeline(createReadStream(archive), createGunzip(), createWriteStream(target), { signal });
      await chmod(target, 0o755);
    } else {
      await pipeline(createReadStream(archive), createWriteStream(target), { signal });
    }
  }
}
