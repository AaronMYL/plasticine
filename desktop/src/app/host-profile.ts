// 第一次的引导要的两样（2026-11-12《首次使用解耦》）：这台电脑的系统全名（「叫你什么」预填）和装了哪几个常用笔记应用
// （推「导入 xx 笔记」）。只看装没装：Mac 列 /Applications 和 ~/Applications 里的 .app，Windows 列开始菜单里的快捷方式；
// 只回 ONBOARDING_APPS 里认出来的那几个，别的应用名不往外给，也不读任何应用的内容。读不到就当没有，不报错。

import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import type { HostProfile, OnboardingApp } from '../../../agent/shared/api/desktop-bridge.ts';

/** 应用（或快捷方式）的名字里有这些字就算装了；比较前都转小写。 */
const APP_NAMES: Readonly<Record<OnboardingApp, readonly string[]>> = {
  obsidian: ['obsidian'],
  notion: ['notion'],
  bear: ['bear'],
  evernote: ['evernote', '印象笔记'],
  logseq: ['logseq'],
  'apple-notes': ['notes', '备忘录'],
};

/** 从一串应用名里认出笔记应用（去掉 .app / .lnk 后整词比，「Notion Calendar」不算 Notion）。 */
export function recognizeApps(names: readonly string[], platform: NodeJS.Platform): OnboardingApp[] {
  const plain = new Set(names.map((name) => name.replace(/\.(app|lnk)$/i, '').trim().toLowerCase()));
  const found = (Object.keys(APP_NAMES) as OnboardingApp[]).filter((app) => {
    if (app === 'apple-notes') return platform === 'darwin';
    return APP_NAMES[app].some((name) => plain.has(name));
  });
  return found;
}

async function listNames(directory: string, depth: number): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const names: string[] = [];
  for (const entry of entries) {
    names.push(entry.name);
    if (depth > 0 && entry.isDirectory() && !entry.name.endsWith('.app')) {
      names.push(...await listNames(join(directory, entry.name), depth - 1));
    }
  }
  return names;
}

function appDirectories(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): [string, number][] {
  if (platform === 'darwin') return [['/Applications', 1], [join(home, 'Applications'), 1]];
  if (platform === 'win32') {
    const menus = [env['ProgramData'], env['APPDATA']].filter((value): value is string => value !== undefined)
      .map((root) => join(root, 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
    return menus.map((path) => [path, 2]);
  }
  return [];
}

/** Mac 用 `id -F` 拿全名；别的系统（或拿不到）用登录名。 */
function fullName(platform: NodeJS.Platform): Promise<string | null> {
  const fallback = (): string | null => {
    try {
      const name = userInfo().username.trim();
      return name === '' ? null : name.slice(0, 100);
    } catch {
      return null;
    }
  };
  if (platform !== 'darwin') return Promise.resolve(fallback());
  return new Promise((resolve) => {
    execFile('id', ['-F'], { timeout: 2000 }, (error, stdout) => {
      const name = error === null ? stdout.trim() : '';
      resolve(name === '' ? fallback() : name.slice(0, 100));
    });
  });
}

export async function readHostProfile(platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env, home: string = userInfo().homedir): Promise<HostProfile> {
  const names = (await Promise.all(appDirectories(platform, env, home)
    .map(([path, depth]) => listNames(path, depth)))).flat();
  return { fullName: await fullName(platform), apps: recognizeApps(names, platform) };
}
