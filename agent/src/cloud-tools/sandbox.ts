// 沙盒（11-16 能力总表「跑代码」「数据分析」）：在 Plasticine 所在的 Linux 服务器上起一个一次性的 systemd 单元跑 Python
// 或 Node——临时用户（DynamicUser）、系统目录只读、看不到家目录、连不上本机和内网的服务（数据库、浏览器调试口）、
// 限内存限进程数限时。只有一个工作目录 /work：放代码和带进来的文件，out/ 里写出来的拿回来。用完整个目录删掉。
// 起单元要 sudo（Plasticine 的账号有免密 sudo，server_exec 也是这么跑的）；Mac、Windows 上没有沙盒。

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { CloudToolError } from './errors.ts';

export const SANDBOX_TIMEOUT_DEFAULT_S = 60;
export const SANDBOX_TIMEOUT_MAX_S = 600;
/** 输出最多收这么多字（stdout、stderr 各自）。 */
const OUTPUT_MAX_CHARS = 100_000;
/** out/ 里拿回来的文件：最多这么多个、一共这么大。 */
export const SANDBOX_OUTPUTS_MAX = 20;
export const SANDBOX_OUTPUTS_MAX_BYTES = 50 * 1024 * 1024;
const SYSTEMD_RUN = '/usr/bin/systemd-run';
// 本机和内网：沙盒里连不上（Plasticine 的服务、浏览器调试口、云上的内网）；公网照常（查资料、下数据）。
const DENIED_NETWORKS = '127.0.0.0/8 ::1/128 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 fc00::/7 fe80::/10';

export interface SandboxFile {
  name: string;
  data: Buffer;
}

export interface SandboxRequest {
  language: 'python' | 'node';
  code: string;
  files: readonly SandboxFile[];
  timeoutSeconds: number;
}

export interface SandboxResult {
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  outputs: SandboxFile[];
  skipped: string[];
}

export interface SandboxOptions {
  /** 临时工作目录放在哪下面（状态目录里的 sandbox/）。 */
  root: string;
  /** 测试换成直接跑（不起 systemd 单元）。 */
  launch?: (args: readonly string[], cwd: string, signal: AbortSignal) => Promise<LaunchResult>;
  platform?: NodeJS.Platform;
}

export interface LaunchResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function launchSystemd(args: readonly string[], _cwd: string, signal: AbortSignal): Promise<LaunchResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('sudo', ['-n', SYSTEMD_RUN, ...args], { signal, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = `${stdout}${chunk.toString('utf8')}`.slice(-OUTPUT_MAX_CHARS);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(-OUTPUT_MAX_CHARS);
    });
    child.on('error', (cause) => reject(new CloudToolError('not_configured', `沙盒没起来：${cause.message}`)));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/** 文件名只留最后一段、去掉开头的点：带进来的文件都平放在 /work/in/ 下。 */
function safeName(name: string): string {
  const clean = basename(name).replace(/^\.+/, '').replace(/[\u0000-\u001f/\\]/g, '_');
  return clean === '' ? 'file' : clean;
}

export class Sandbox {
  readonly #root: string;
  readonly #launch: SandboxOptions['launch'];
  readonly #platform: NodeJS.Platform;

  constructor(options: SandboxOptions) {
    this.#root = options.root;
    this.#launch = options.launch;
    this.#platform = options.platform ?? process.platform;
  }

  available(): boolean {
    return this.#launch !== undefined || (this.#platform === 'linux' && existsSync(SYSTEMD_RUN));
  }

  async run(request: SandboxRequest, signal: AbortSignal): Promise<SandboxResult> {
    if (!this.available()) {
      throw new CloudToolError('not_configured', '这台机器上没有沙盒：要在 Linux 服务器上（systemd）。');
    }
    const work = join(this.#root, randomUUID());
    mkdirSync(join(work, 'in'), { recursive: true });
    mkdirSync(join(work, 'out'), { recursive: true });
    try {
      // 沙盒里是临时用户：目录要谁都能写，文件谁都能读。
      for (const directory of [work, join(work, 'in'), join(work, 'out')]) {
        chmodSync(directory, 0o777);
      }
      const script = request.language === 'python' ? 'main.py' : 'main.mjs';
      writeFileSync(join(work, script), request.code, { mode: 0o644 });
      for (const file of request.files) {
        writeFileSync(join(work, 'in', safeName(file.name)), file.data, { mode: 0o644 });
      }
      const seconds = Math.min(SANDBOX_TIMEOUT_MAX_S, Math.max(1, Math.round(request.timeoutSeconds)));
      const interpreter = request.language === 'python' ? '/usr/bin/python3' : process.execPath;
      const args = ['--quiet', '--pipe', '--wait', '--collect',
        '-p', 'DynamicUser=yes', '-p', 'ProtectSystem=strict', '-p', 'ProtectHome=yes', '-p', 'PrivateTmp=yes',
        '-p', 'PrivateDevices=yes', '-p', 'NoNewPrivileges=yes', '-p', `IPAddressDeny=${DENIED_NETWORKS}`,
        '-p', 'MemoryMax=1G', '-p', 'TasksMax=64', '-p', `RuntimeMaxSec=${seconds}`, '-p', 'UMask=0000',
        '-p', `BindPaths=${work}:/work`, '-p', 'WorkingDirectory=/work', '-E', 'HOME=/work', '-E', 'LANG=C.UTF-8',
        interpreter, script];
      const limited = AbortSignal.any([signal, AbortSignal.timeout((seconds + 15) * 1000)]);
      const started = Date.now();
      const launched = await (this.#launch ?? launchSystemd)(args, work, limited);
      const timedOut = Date.now() - started >= seconds * 1000 && launched.code !== 0;
      return { exitCode: launched.code, timedOut, stdout: launched.stdout, stderr: launched.stderr,
        ...this.#outputs(join(work, 'out')) };
    } finally {
      // 这次自己建的工作目录（沙盒用 UMask=0000 写的，Plasticine 的账号删得掉），用完就清。
      rmSync(work, { recursive: true, force: true });
    }
  }

  #outputs(directory: string): { outputs: SandboxFile[]; skipped: string[] } {
    const outputs: SandboxFile[] = [];
    const skipped: string[] = [];
    let bytes = 0;
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      const size = statSync(path).isFile() ? statSync(path).size : -1;
      if (size < 0 || outputs.length >= SANDBOX_OUTPUTS_MAX || bytes + size > SANDBOX_OUTPUTS_MAX_BYTES) {
        skipped.push(name);
        continue;
      }
      bytes += size;
      outputs.push({ name, data: readFileSync(path) });
    }
    return { outputs, skipped };
  }
}
