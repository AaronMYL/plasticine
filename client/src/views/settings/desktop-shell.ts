// 设置 · 系统里桌面客户端那几行用的壳接口（agent/shared/api/desktop-bridge.ts 的 PlasticineDesktopBridge）：本体跑在哪、
// 客户端更新、系统通知、让 Plasticine 用这台电脑。只有 Electron 壳有（window.plasticineDesktop 带 server）；网页、手机、
// 旧 Mac App 没有，这几行就不出。壳回的数据先按共享 schema 校验；壳报的状态变化经 window.__plasticineDesktopEvent
// 进来，这里转成一个 window 事件，几处一起听。

import { useEffect, useState } from 'react';
import { Value } from 'typebox/value';
import { DesktopEventSchema, DeviceServiceStatusSchema, ServerStatusSchema, UpdateStatusSchema,
  type DesktopEvent, type DeviceServiceStatus, type PlasticineDesktopBridge, type ServerStatus,
  type UpdateStatus } from '../../api/shared.ts';

const EVENT = 'plasticine:desktop';

type DesktopWindow = Window & {
  plasticineDesktop?: Partial<PlasticineDesktopBridge>;
  __plasticineDesktopEvent?: (event: unknown) => void;
};

export type DesktopShell = Pick<PlasticineDesktopBridge, 'version' | 'platform' | 'server' | 'updates' | 'device'
  | 'notifications'>;

/** Electron 壳的接口；不在桌面客户端里是 null。 */
export function desktopShell(): DesktopShell | null {
  const bridge = (window as DesktopWindow).plasticineDesktop;
  if (bridge?.server === undefined || bridge.updates === undefined || bridge.device === undefined
    || bridge.notifications === undefined || bridge.version === undefined || bridge.platform === undefined) {
    return null;
  }
  return bridge as DesktopShell;
}

/** 这台电脑叫什么：Mac 上是「这台 Mac」，别的是「这台电脑」。 */
export function computerName(shell: DesktopShell): string {
  return shell.platform === 'macos' ? '这台 Mac' : '这台电脑';
}

function listen(): void {
  const host = window as DesktopWindow;
  host.__plasticineDesktopEvent ??= (event: unknown) => {
    if (Value.Check(DesktopEventSchema, event)) {
      window.dispatchEvent(new CustomEvent<DesktopEvent>(EVENT, { detail: event }));
    }
  };
}

export interface DesktopState {
  server: ServerStatus | null;
  update: UpdateStatus | null;
  device: DeviceServiceStatus | null;
  notifications: boolean | null;
  /** 读壳没成时的一句。 */
  error: string | null;
}

function malformed(what: string): Error {
  return new Error(`桌面客户端回的${what}形状不对`);
}

export function parseServer(value: unknown): ServerStatus {
  if (!Value.Check(ServerStatusSchema, value)) {
    throw malformed('本体状态');
  }
  return value;
}

export function parseUpdate(value: unknown): UpdateStatus {
  if (!Value.Check(UpdateStatusSchema, value)) {
    throw malformed('更新状态');
  }
  return value;
}

export function parseDevice(value: unknown): DeviceServiceStatus {
  if (!Value.Check(DeviceServiceStatusSchema, value)) {
    throw malformed('设备服务状态');
  }
  return value;
}

/** 读一次壳的四样状态，之后跟着壳报的变化走。 */
export function useDesktopState(shell: DesktopShell | null): [DesktopState, (change: Partial<DesktopState>) => void] {
  const [state, setState] = useState<DesktopState>({ server: null, update: null, device: null, notifications: null,
    error: null });
  const change = (next: Partial<DesktopState>): void => setState((value) => ({ ...value, ...next }));
  useEffect(() => {
    if (shell === null) {
      return undefined;
    }
    let alive = true;
    const fail = (cause: unknown): void => {
      if (alive) {
        change({ error: cause instanceof Error ? cause.message : '没读到桌面客户端的状态' });
      }
    };
    shell.server.status().then((value) => alive && change({ server: parseServer(value) }), fail);
    shell.updates.status().then((value) => alive && change({ update: parseUpdate(value) }), fail);
    shell.device.status().then((value) => alive && change({ device: parseDevice(value) }), fail);
    shell.notifications.enabled().then((value) => alive && change({ notifications: value === true }), fail);
    listen();
    const receive = (event: Event): void => {
      const detail = (event as CustomEvent<DesktopEvent>).detail;
      if (detail.type === 'server') {
        change({ server: detail.status });
      } else if (detail.type === 'update') {
        change({ update: detail.status });
      } else {
        change({ device: detail.status });
      }
    };
    window.addEventListener(EVENT, receive);
    return () => {
      alive = false;
      window.removeEventListener(EVENT, receive);
    };
  }, [shell]);
  return [state, change];
}
