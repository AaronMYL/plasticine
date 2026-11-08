// 设备上的路径（壳管规矩，助手只照参数做）：展开 ~、解开符号链接（连悬空的也解），再按目录边界判断在不在授权目录里。
// 两层授权都要过：本机的授权目录（设置里，默认整个家目录；空表示不授权）和本体给的上限 roots（空列表表示云端不另加
// 限制，第 97 条）。和 Mac 壳 path-policy.swift 同一套。Windows 上本体发来的是 ~/… 或 /C:/… 这种正斜杠写法，这里换成
// 本机写法；比较时不分大小写（NTFS 不分）。

import { lstatSync, readlinkSync, realpathSync } from 'node:fs';
import { posix, win32 } from 'node:path';

/** 解链接最多跟这么多层：再多是环。 */
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

/** 本体给的路径 → 本机的绝对路径（还没解链接）。只收 /、~ 开头（Windows 另收 C:/ 这种盘符开头）。 */
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

/** 解开所有符号链接（包括最后一段是悬空链接）；还不存在的部分按字面接在已存在的那一截后面。 */
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

/**
 * 本体给的路径 → 本机真实路径，并核对两层授权。不过就抛 PathRefused（一句原因，进回执）。
 * cloudRoots 为空表示云端不另加限制；localRoots 为空表示这台电脑没授权任何目录。
 */
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
