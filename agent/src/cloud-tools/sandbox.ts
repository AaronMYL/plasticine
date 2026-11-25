import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { CloudToolError } from './errors.ts';

export const SANDBOX_TIMEOUT_DEFAULT_S = 60;
export const SANDBOX_TIMEOUT_MAX_S = 600;
const OUTPUT_MAX_CHARS = 100_000;
export const SANDBOX_OUTPUTS_MAX = 20;
export const SANDBOX_OUTPUTS_MAX_BYTES = 50 * 1024 * 1024;
const SYSTEMD_RUN = '/usr/bin/systemd-run';
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
  root: string;
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
