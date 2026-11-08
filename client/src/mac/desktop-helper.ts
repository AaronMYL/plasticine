// Electron 壳里的设备助手（《优化清单》第 14、15 条）：网页经壳的预加载桥调 Mac 助手进程的方法（协议在
// agent/shared/desktop-helper-protocol.ts）。桥的名字和形状由 electron 线在 desktop/ 里定（docs/specs/desktop-helper.md），
// 按 window.plasticineDesktop.helper.call(method, params) 取（经 shell/host.ts）。网页版、手机、旧 Mac App 没有这座桥。

import type { HelperMethod, HelperParams, HelperResult } from '../../../agent/shared/desktop-helper-protocol.ts';
import { hostHelper } from '../shell/host.ts';

export interface DesktopHelperBridge {
  call<M extends HelperMethod>(method: M, params: HelperParams<M>): Promise<HelperResult<M>>;
}

export function desktopHelper(): DesktopHelperBridge | null {
  return hostHelper();
}
