import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FILE_FIND_MAX, type DeviceActionParams } from '../../../agent/shared/api/index.ts';
import { authorizedPath, type PathSystem } from './path-policy.ts';

export interface DeskPort {
  state(): { idleSeconds: number; locked: boolean; onBattery: boolean; keptAwake: boolean };
  clipboardRead(): Promise<{ text: string; html: string | null }>;
  clipboardWrite(text: string, html: string | null): Promise<void>;
  chooseFolder(reason: string): Promise<string | null>;
  addRoot(path: string): void;
  open(target: string, app: string | null): Promise<void>;
}

export interface DeskContext {
  desk: DeskPort;
  paths: PathSystem;
  localRoots: readonly string[];
  cloudRoots: readonly string[];
}

export const DESK_SHELL_KINDS = ['device_state', 'clipboard_read', 'clipboard_write', 'folder_request', 'file_find',
  'open_in_app'] as const;
export const DESK_MAC_KINDS = ['app_script', 'shortcut_list', 'shortcut_run'] as const;

const FIND_SCAN_MAX = 50_000;
const FIND_DEPTH_MAX = 8;
const SCRIPT_TIMEOUT_MS = 110_000;
const OUTPUT_MAX_BYTES = 200 * 1024;
const SKIPPED_DIRS: ReadonlySet<string> = new Set(['node_modules', 'Library', '.git', '.Trash']);

function run(file: string, args: readonly string[], timeoutMs = SCRIPT_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs, maxBuffer: OUTPUT_MAX_BYTES, windowsHide: true },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve(stdout);
        } else {
          reject(new Error(String(stderr).trim().split('\n').at(-1)?.slice(0, 300) || error.message));
        }
      });
  });
}

async function find(root: string, name: string, limit: number): Promise<Record<string, unknown>> {
  const needle = name.toLowerCase();
  const matches: { path: string; type: 'file' | 'dir'; size: number; modifiedAt: string }[] = [];
  let scanned = 0;
  let truncated = false;
  const queue: { path: string; depth: number }[] = [{ path: root, depth: 0 }];
  while (queue.length > 0 && !truncated) {
    const next = queue.shift();
    if (next === undefined) break;
    let entries;
    try {
      entries = await readdir(next.path, { withFileTypes: true });
    } catch (error) {
      if (error instanceof Error) continue;
      throw error;
    }
    for (const entry of entries) {
      scanned += 1;
      if (scanned > FIND_SCAN_MAX || matches.length >= limit) {
        truncated = true;
        break;
      }
      if (entry.name.startsWith('.')) continue;
      const path = join(next.path, entry.name);
      if (entry.isDirectory() && !SKIPPED_DIRS.has(entry.name) && next.depth < FIND_DEPTH_MAX) {
        queue.push({ path, depth: next.depth + 1 });
      }
      if (entry.name.toLowerCase().includes(needle) && (entry.isFile() || entry.isDirectory())) {
        const info = await stat(path);
        matches.push({ path, type: entry.isDirectory() ? 'dir' : 'file', size: info.isFile() ? info.size : 0,
          modifiedAt: info.mtime.toISOString() });
      }
    }
  }
  return { matches, truncated };
}

async function runShortcut(name: string, input: string | null): Promise<Record<string, unknown>> {
  const dir = await mkdtemp(join(tmpdir(), 'plasticine-shortcut-'));
  try {
    const output = join(dir, 'out.txt');
    const args = ['run', name, '--output-path', output];
    if (input !== null) {
      const inputPath = join(dir, 'in.txt');
      await writeFile(inputPath, input);
      args.push('--input-path', inputPath);
    }
    await run('/usr/bin/shortcuts', args);
    const text = await readFile(output, 'utf8').catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
      throw error;
    });
    return { outcome: 'success', output: text };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function runDeskAction(action: DeviceActionParams, context: DeskContext)
  : Promise<Record<string, unknown> | null> {
  const real = (raw: string): string => authorizedPath(raw, context.localRoots, context.cloudRoots, context.paths);
  const mac = context.paths.platform === 'darwin';
  switch (action.kind) {
    case 'device_state':
      return context.desk.state();
    case 'clipboard_read':
      return context.desk.clipboardRead();
    case 'clipboard_write':
      await context.desk.clipboardWrite(action.text, action.html);
      return {};
    case 'folder_request': {
      const path = await context.desk.chooseFolder(action.reason);
      if (path !== null) context.desk.addRoot(path);
      return { path };
    }
    case 'file_find':
      return find(real(action.root), action.name, Math.min(action.limit, FILE_FIND_MAX));
    case 'open_in_app': {
      const web = /^https?:\/\//i.test(action.target);
      await context.desk.open(web ? action.target : real(action.target), action.app);
      return {};
    }
    case 'app_script':
      if (!mac) throw new Error('AppleScript 只有 Mac 上有。');
      return { output: (await run('/usr/bin/osascript', ['-e', action.script])).trimEnd() };
    case 'shortcut_list':
      if (!mac) throw new Error('快捷指令只有 Mac 上有。');
      return { shortcuts: (await run('/usr/bin/shortcuts', ['list'])).split('\n').map((line) => line.trim())
        .filter((line) => line !== '') };
    case 'shortcut_run':
      if (!mac) throw new Error('快捷指令只有 Mac 上有。');
      return runShortcut(action.name, action.input);
    default:
      return null;
  }
}
