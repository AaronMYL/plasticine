// 测试用的假助手：照 agent/shared/desktop-helper-protocol.ts 的协议在 stdin / stdout 上收发（一行一个 JSON，按 id 回），
// 文件和命令真做（在临时目录里），截屏回一张固定的 1×1 PNG。FAKE_HELPER_MODE=crash 收到第一条非 info 请求就退出。

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const mode = process.env.FAKE_HELPER_MODE ?? '';
let shots = 0;
let roots: string[] = [];

function send(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function sha(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

class Failure extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function inside(path: string): void {
  if (!roots.some((root) => path === root || path.startsWith(`${root}/`))) {
    throw new Failure('refused', '不在授权目录里');
  }
}

type Params = Record<string, unknown>;

async function handle(method: string, params: Params): Promise<Record<string, unknown>> {
  switch (method) {
    case 'helper.info':
      return { name: 'fake-helper', version: '1', protocol: 1, methods: ['helper.info', 'helper.configure', 'cancel',
        'permissions.status', 'screenshot', 'click', 'files.list', 'files.read', 'files.write', 'command.run'] };
    case 'helper.configure':
      roots = (params.roots as string[]) ?? [];
      return { roots };
    case 'permissions.status':
      return { screen: true, accessibility: false, calendar: 'denied', reminders: 'not_determined' };
    case 'screenshot':
      shots += 1;
      return { png: PNG, width: 1, height: 1 };
    case 'click':
      if (shots === 0) {
        throw new Failure('screenshot_stale', '还没截过图');
      }
      return { changed: false };
    case 'files.list': {
      const path = String(params.path);
      inside(path);
      return { entries: readdirSync(path).map((name) => {
        const info = statSync(join(path, name));
        return { name, type: info.isDirectory() ? 'dir' : 'file', size: info.size,
          modifiedAt: info.mtime.toISOString() };
      }) };
    }
    case 'files.read': {
      const path = String(params.path);
      inside(path);
      const bytes = readFileSync(path);
      return { content: bytes.toString('utf8'), encoding: 'utf8', version: sha(bytes) };
    }
    case 'files.write': {
      const path = String(params.path);
      inside(path);
      writeFileSync(`${path}.partial`, String(params.content));
      renameSync(`${path}.partial`, path);
      return { version: sha(readFileSync(path)) };
    }
    case 'command.run':
      return await new Promise((resolve) => {
        execFile('/bin/sh', ['-c', String(params.command)], { cwd: String(params.cwd) }, (error, stdout, stderr) => {
          const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
          resolve({ exitCode: code, stdout, stderr, truncated: false });
        });
      });
    default:
      throw new Failure('unknown_method', `不会 ${method}`);
  }
}

const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  const request = JSON.parse(line) as { id: string; method: string; params?: Params };
  if (mode === 'crash' && request.method !== 'helper.info' && request.method !== 'helper.configure') {
    process.exit(3);
  }
  handle(request.method, request.params ?? {}).then(
    (result) => send({ id: request.id, result }),
    (error: Failure) => send({ id: request.id, error: { code: error.code ?? 'failed', message: error.message } }),
  );
});
lines.on('close', () => process.exit(0));
