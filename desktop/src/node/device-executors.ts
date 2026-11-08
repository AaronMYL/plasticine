// 交给系统助手做的设备动作：壳先核两层授权目录（本机的和本体上限的），按两端共用的 helperCallFor 换成一次助手调用，
// 回执原样交回（助手回的就是设备动作的回执形状：文件版本是写完重新读盘算的，点按 / 输入带 afterShot）。
// 删除和打开应用不归助手：删除挪进废纸篓 / 回收站（壳用系统的），打开应用 Mac 用 open -a、Windows 用 start。

import { execFile } from 'node:child_process';
import type { DeviceActionParams } from '../../../agent/shared/api/index.ts';
import { helperCallFor, type HelperMethod, type HelperParams } from '../../../agent/shared/desktop-helper-protocol.ts';
import type { HelperProcess } from '../helper/helper-process.ts';
import { authorizedPath, type PathSystem } from './path-policy.ts';

export interface ExecutorContext {
  helper: HelperProcess;
  paths: PathSystem;
  localRoots: readonly string[];
  cloudRoots: readonly string[];
  /** 挪进废纸篓（Electron 的 shell.trashItem）。 */
  trash(path: string): Promise<void>;
}

/** 壳自己做、但要用到助手以外的系统能力的动作。 */
export const SHELL_DEVICE_KINDS = ['file_delete', 'app_open'] as const;

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

/** 路径参数换成核过授权的本机真实路径。 */
function withRealPath(action: DeviceActionParams, context: ExecutorContext): DeviceActionParams {
  const real = (raw: string): string => authorizedPath(raw, context.localRoots, context.cloudRoots, context.paths);
  switch (action.kind) {
    case 'file_list':
    case 'file_read':
    case 'file_write':
    case 'file_delete':
      return { ...action, path: real(action.path) };
    case 'run_command':
      return { ...action, cwd: real(action.cwd) };
    default:
      return action;
  }
}

/** 这个动作交给助手还是壳自己；都不归回 null。 */
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
  const call = helperCallFor(resolved);
  if (call === null) {
    return null;
  }
  const method: HelperMethod = call.method;
  return context.helper.call(method, call.params as HelperParams<typeof method>);
}
