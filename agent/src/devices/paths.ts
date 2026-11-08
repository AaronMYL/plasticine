// 设备上的路径：先规范化（去掉 . 和 ..、多余的 /），再判断在不在授权目录里、碰没碰受保护路径。只收 / 或 ~ 开头的路径：
// 相对路径要设备自己补「相对谁」，那就是设备在补判断（《应用架构方案》第 4 节：参数由云端给齐）。
// 受保护的判断不分大小写（宁可多拒），授权目录的判断分大小写（宁可少放）。

import { posix } from 'node:path';
import { PROTECTED_DEVICE_PATHS } from './defaults.ts';

export type NormalizedPath = { ok: true; path: string } | { ok: false; reason: string };

export function normalizeDevicePath(raw: string): NormalizedPath {
  if (raw.includes('\u0000') || raw.includes('\\')) {
    return { ok: false, reason: '路径里有不能用的字符（\\ 或空字符）。' };
  }
  if (!raw.startsWith('/') && raw !== '~' && !raw.startsWith('~/')) {
    return { ok: false, reason: `「${raw}」不是 / 或 ~ 开头的完整路径，设备不替云端补全。` };
  }
  let path = posix.normalize(raw);
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }
  // `~/../x` normalises to a relative path: it climbed out of the home directory.
  if (!path.startsWith('/') && path !== '~' && !path.startsWith('~/')) {
    return { ok: false, reason: `「${raw}」用 .. 跳出了起点，不收。` };
  }
  return { ok: true, path };
}

function globSource(pattern: string): string {
  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index] ?? '';
    if (char === '*' && pattern[index + 1] === '*') {
      // `**/` matches zero or more directories, `/**` the directory itself and everything below.
      if (pattern[index + 2] === '/') {
        source += '(?:.*/)?';
        index += 2;
      } else {
        source += '.*';
        index += 1;
      }
    } else if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return source;
}

/** `**` crosses directories, `*` and `?` do not; `dir/**` also matches `dir` itself. */
export function globMatcher(pattern: string, caseInsensitive: boolean): RegExp {
  const base = pattern.endsWith('/**') ? `${globSource(pattern.slice(0, -3))}(?:/.*)?` : globSource(pattern);
  return new RegExp(`^${base}$`, caseInsensitive ? 'i' : '');
}

const PROTECTED = PROTECTED_DEVICE_PATHS.map((rule) => ({ ...rule, matcher: globMatcher(rule.pattern, true) }));

/** The protected rule a normalised path falls under, if any. */
export function protectedRule(path: string): { pattern: string; why: string } | undefined {
  const found = PROTECTED.find((rule) => rule.matcher.test(path));
  return found === undefined ? undefined : { pattern: found.pattern, why: found.why };
}

/** Whether a normalised path is one of the roots or inside one (roots are normalised here too). */
export function withinRoots(path: string, roots: readonly string[]): boolean {
  return roots.some((raw) => {
    const root = normalizeDevicePath(raw);
    if (!root.ok) {
      return false;
    }
    return path === root.path || path.startsWith(root.path === '/' ? '/' : `${root.path}/`);
  });
}

// Words of a command that look like paths: they start with / or ~ (quotes stripped).
const PATH_WORD = /(?:^|[\s=:'"(])((?:~|\/)[^\s'"();|&<>]*)/g;

/** Every path a command line names; the protected check runs on each of them. */
export function pathsInCommand(command: string): string[] {
  return [...command.matchAll(PATH_WORD)].map((match) => match[1] ?? '').filter((word) => word !== '');
}

// 删除类命令默认拒绝、需单独授权（第 4 节命令行一行）：按「删」这一类算，走逐次确认。
const DELETING_COMMAND = /(?:^|[\s;&|(])(?:rm|rmdir|unlink|shred|srm|trash)(?:\s|$)|\s-delete\b|\bgit\s+clean\b/;

export function deletesFiles(command: string): boolean {
  return DELETING_COMMAND.test(command);
}
