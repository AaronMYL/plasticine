// 桌面客户端在各系统上把东西放哪。数据和旧客户端放在同一处，手动换成 Electron 版以后本机本体的数据照旧接上：
// - Mac：~/Library/Application Support/Plasticine/server（Swift 版「这台 Mac」的数据目录）、日志 ~/Library/Logs/Plasticine；
//   Electron 自己的网页数据单放 Plasticine/Desktop，不和 server、node-credential 混在一起。
// - Windows：%LOCALAPPDATA%\Plasticine\state、logs（Inno Setup 托盘版的数据目录）；Electron 的单放 Plasticine\Desktop。
// - Linux 只在开发和冒烟测试时用。

import { join, win32 } from 'node:path';

export type ShellPlatform = 'darwin' | 'win32' | 'linux';

export interface DesktopPaths {
  /** Plasticine 自己的根（Swift 版、托盘版也用这个）。 */
  root: string;
  /** Electron 的 userData：网页数据、Cookie、设置、凭证、回执。 */
  userData: string;
  /** 本机本体的数据目录（PLASTICINE_STATE）。 */
  serverState: string;
  logs: string;
  settingsFile: string;
  /** 节点凭证（safeStorage 加密），按本体源地址分开。 */
  credentials: string;
  /** Swift 版留下的明文凭证目录（只读一次搬进来，不删）。 */
  legacyCredentials: string;
  /** 设备动作回执，按本体和节点分开。 */
  actions: string;
  /** 下载好的更新、留作回退的上一版。 */
  updates: string;
}

export interface PathEnvironment {
  home: string;
  /** 显式的独立客户端目录：测试与预览的状态全部放在这里，不触碰正在使用的实例。 */
  userData?: string;
  /** Windows 的 %LOCALAPPDATA%；别的系统不用。 */
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
