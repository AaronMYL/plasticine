import { join, win32 } from 'node:path';

export type ShellPlatform = 'darwin' | 'win32' | 'linux';

export interface DesktopPaths {
  root: string;
  userData: string;
  serverState: string;
  logs: string;
  settingsFile: string;
  credentials: string;
  legacyCredentials: string;
  actions: string;
  updates: string;
}

export interface PathEnvironment {
  home: string;
  userData?: string;
  localAppData?: string;
}

function rootOf(platform: ShellPlatform, environment: PathEnvironment): string {
  if (platform === 'darwin') {
    return join(environment.home, 'Library', 'Application Support', 'Plasticine');
  }
  if (platform === 'win32') {
    const local = environment.localAppData ?? win32.join(environment.home, 'AppData', 'Local');
    return win32.join(local, 'Plasticine');
  }
  return join(environment.home, '.local', 'share', 'plasticine-desktop');
}

export function desktopPaths(platform: ShellPlatform, environment: PathEnvironment): DesktopPaths {
  const root = environment.userData ?? rootOf(platform, environment);
  const path = platform === 'win32' ? win32.join : join;
  const userData = environment.userData ?? path(root, 'Desktop');
  const logs = platform === 'darwin' && environment.userData === undefined
    ? join(environment.home, 'Library', 'Logs', 'Plasticine') : path(root, 'logs');
  return {
    root,
    userData,
    serverState: path(root, platform === 'win32' ? 'state' : 'server'),
    logs,
    settingsFile: path(userData, 'settings.json'),
    credentials: path(userData, 'node-credential'),
    legacyCredentials: path(root, environment.userData === undefined ? 'node-credential' : 'legacy-node-credential'),
    actions: path(userData, 'actions'),
    updates: path(userData, 'updates'),
  };
}
