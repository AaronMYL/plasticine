// 第一次打开 Electron 版时读一下 Swift 版 Mac App 存的远程地址，给开始页「连到我的 Plasticine」那一格预填（11-08 起
// 不再拿它替他选，开始页先二选一）。Swift 版存在 com.plasticine.app 的 defaults 里（serverMode：thisMac / remote；
// server：https 地址）。只读，不改不删。

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface LegacyChoice {
  mode: 'this_computer' | 'remote' | null;
  remote: string | null;
  priorInstall: boolean;
}

const DOMAIN = 'com.plasticine.app';

function readDefault(key: string): string | null {
  try {
    return execFileSync('/usr/bin/defaults', ['read', DOMAIN, key], { encoding: 'utf8', timeout: 5_000 }).trim();
  } catch (error) {
    // defaults 没有这个键时退出码是 1：按没有处理。
    if ((error as { status?: number }).status === 1) {
      return null;
    }
    throw error;
  }
}

export function legacyChoice(platform: NodeJS.Platform, root: string): LegacyChoice {
  // Windows 托盘版只有「这台电脑」一种；数据目录在就当装过，照旧这台电脑。
  if (platform !== 'darwin') {
    return { mode: platform === 'win32' && existsSync(join(root, 'state')) ? 'this_computer' : null, remote: null,
      priorInstall: existsSync(root) };
  }
  const mode = readDefault('serverMode');
  const remote = readDefault('server');
  return {
    mode: mode === 'thisMac' ? 'this_computer' : mode === 'remote' ? 'remote' : null,
    remote,
    priorInstall: mode !== null || remote !== null || existsSync(root),
  };
}
