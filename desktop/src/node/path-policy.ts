import { lstatSync, readlinkSync, realpathSync } from 'node:fs';
import { posix, win32 } from 'node:path';

const LINK_DEPTH_MAX = 40;

export class PathRefused extends Error {}

export interface PathSystem {
  platform: 'darwin' | 'win32' | 'linux';
  home: string;
  realpath(path: string): string;
  lstatIsLink(path: string): boolean | null;
  readlink(path: string): string;
}

export function realPathSystem(platform: PathSystem['platform'], home: string): PathSystem {
  return {
    platform,
    home,
    realpath: (path) => realpathSync.native(path),
    lstatIsLink(path) {
      try {
        return lstatSync(path).isSymbolicLink();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return null;
        }
        throw error;
      }
    },
    readlink: (path) => readlinkSync(path),
  };
}

function flavor(system: PathSystem): typeof posix {
  return system.platform === 'win32' ? win32 : posix;
}

export function expandPath(raw: string, system: PathSystem): string {
  const path = flavor(system);
  if (raw.includes('\u0000')) {
    throw new PathRefused('路径里有不能用的空字符。');
  }
  if (raw === '~' || raw.startsWith('~/')) {
    return path.resolve(system.home, `.${raw.slice(1)}`);
  }
  if (system.platform === 'win32') {
    const drive = /^\/?([A-Za-z]:)([\\/].*)?$/.exec(raw);
    if (drive !== null) {
      return win32.resolve(`${drive[1] ?? ''}\\`, (drive[2] ?? '').replace(/^[\\/]/, ''));
    }
    throw new PathRefused(`「${raw}」不是 ~ 或盘符开头的完整路径，设备不替本体补全。`);
  }
  if (!raw.startsWith('/')) {
    throw new PathRefused(`「${raw}」不是 / 或 ~ 开头的完整路径，设备不替本体补全。`);
  }
  return posix.resolve(raw);
}

export function resolveReal(absolute: string, system: PathSystem, depth = 0): string {
  if (depth > LINK_DEPTH_MAX) {
    throw new PathRefused('路径里的符号链接绕成了环。');
  }
  const path = flavor(system);
  try {
    return system.realpath(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
  const parent = path.dirname(absolute);
  if (parent === absolute) {
    return absolute;
  }
  const realParent = resolveReal(parent, system, depth + 1);
  const leaf = path.join(realParent, path.basename(absolute));
  if (system.lstatIsLink(leaf) === true) {
    return resolveReal(path.resolve(realParent, system.readlink(leaf)), system, depth + 1);
  }
  return leaf;
}

export function within(child: string, root: string, system: PathSystem): boolean {
  const path = flavor(system);
  const fold = (value: string): string => (system.platform === 'win32' ? value.toLowerCase() : value);
  const a = fold(child);
  const b = fold(root.endsWith(path.sep) && root.length > 1 ? root.slice(0, -1) : root);
  return a === b || a.startsWith(b.endsWith(path.sep) ? b : `${b}${path.sep}`);
}

export function authorizedPath(raw: string, localRoots: readonly string[], cloudRoots: readonly string[],
  system: PathSystem): string {
  const real = resolveReal(expandPath(raw, system), system);
  const roots = (list: readonly string[]): string[] => list.map((root) => resolveReal(expandPath(root, system),
    system));
  if (!roots(localRoots).some((root) => within(real, root, system))) {
    throw new PathRefused(localRoots.length === 0 ? '这台电脑没有授权任何目录。'
      : `「${raw}」不在这台电脑授权的目录里。`);
  }
  if (cloudRoots.length > 0 && !roots(cloudRoots).some((root) => within(real, root, system))) {
    throw new PathRefused(`「${raw}」不在设备上限的目录范围里。`);
  }
  return real;
}
