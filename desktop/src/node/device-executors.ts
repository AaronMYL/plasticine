import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { DEVICE_FILE_MAX_BYTES, type DeviceActionParams } from '../../../agent/shared/api/index.ts';
import { helperCallFor, type HelperMethod, type HelperParams } from '../../../agent/shared/desktop-helper-protocol.ts';
import type { HelperProcess } from '../helper/helper-process.ts';
import { authorizedPath, type PathSystem } from './path-policy.ts';

export interface ExecutorContext {
  helper: HelperProcess;
  paths: PathSystem;
  localRoots: readonly string[];
  cloudRoots: readonly string[];
  trash(path: string): Promise<void>;
}

export const SHELL_DEVICE_KINDS = ['file_delete', 'app_open', 'file_fetch', 'file_put'] as const;

function openApp(platform: PathSystem['platform'], app: string): Promise<void> {
  const [file, args] = platform === 'darwin' ? ['/usr/bin/open', ['-a', app]]
    : platform === 'win32' ? ['cmd.exe', ['/d', '/s', '/c', 'start', '""', app]] : ['xdg-open', [app]];
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout: 30_000 }, (error) => {
      if (error === null) {
        resolve();
      } else {
        reject(new Error(`没打开「${app}」：这台电脑上找不到这个应用。`));
      }
    });
  });
}

function withRealPath(action: DeviceActionParams, context: ExecutorContext): DeviceActionParams {
  const real = (raw: string): string => authorizedPath(raw, context.localRoots, context.cloudRoots, context.paths);
  switch (action.kind) {
    case 'file_list':
    case 'file_read':
    case 'file_write':
    case 'file_delete':
    case 'file_fetch':
    case 'file_put':
      return { ...action, path: real(action.path) };
    case 'run_command':
      return { ...action, cwd: real(action.cwd) };
    default:
      return action;
  }
}

function missing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function fetchFile(path: string): Promise<Record<string, unknown>> {
  const info = await stat(path);
  if (!info.isFile()) {
    throw new Error('这不是一个文件。');
  }
  if (info.size > DEVICE_FILE_MAX_BYTES) {
    throw new Error(`文件超过 ${DEVICE_FILE_MAX_BYTES / 1024 / 1024} MB，这一版不搬。`);
  }
  const data = await readFile(path);
  return { path, name: basename(path), bytes: data.length, base64: data.toString('base64') };
}

async function putFile(path: string, base64: string, overwrite: boolean, trash: (path: string) => Promise<void>)
  : Promise<Record<string, unknown>> {
  const data = Buffer.from(base64, 'base64');
  const present = await stat(path).then(() => true, (error: unknown) => {
    if (missing(error)) return false;
    throw error;
  });
  if (present && !overwrite) {
    throw new Error('这里已经有同名的文件了：要换掉它带 overwrite: true（旧的进废纸篓）。');
  }
  const temp = join(dirname(path), `.${basename(path)}.${randomUUID()}.part`);
  await writeFile(temp, data, { flag: 'wx', mode: 0o644 });
  if (present) {
    await trash(path);
  }
  await rename(temp, path);
  return { path, bytes: data.length };
}

export function routedToHelper(action: DeviceActionParams): boolean {
  return helperCallFor(action) !== null;
}

export async function runDeviceAction(action: DeviceActionParams, context: ExecutorContext):
  Promise<Record<string, unknown> | null> {
  const resolved = withRealPath(action, context);
  if (resolved.kind === 'file_delete') {
    await context.trash(resolved.path);
    return {};
  }
  if (resolved.kind === 'app_open') {
    await openApp(context.paths.platform, resolved.app);
    return {};
  }
  if (resolved.kind === 'file_fetch') {
    return fetchFile(resolved.path);
  }
  if (resolved.kind === 'file_put') {
    return putFile(resolved.path, resolved.base64, resolved.overwrite, context.trash);
  }
  const call = helperCallFor(resolved);
  if (call === null) {
    return null;
  }
  const method: HelperMethod = call.method;
  return context.helper.call(method, call.params as HelperParams<typeof method>);
}
