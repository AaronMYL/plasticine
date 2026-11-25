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
    if ((error as { status?: number }).status === 1) {
      return null;
    }
    throw error;
  }
}

export function legacyChoice(platform: NodeJS.Platform, root: string): LegacyChoice {
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
