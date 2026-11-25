import { useEffect, useState } from 'react';
import { Value } from 'typebox/value';
import { DesktopEventSchema, DeviceServiceStatusSchema, ServerStatusSchema, UpdateStatusSchema,
  type DesktopEvent, type DeviceServiceStatus, type PlasticineDesktopBridge, type ServerStatus,
  type UpdateStatus } from '../../api/shared.ts';

export const DESKTOP_EVENT = 'plasticine:desktop';

type DesktopWindow = Window & {
  plasticineDesktop?: Partial<PlasticineDesktopBridge>;
  __plasticineDesktopEvent?: (event: unknown) => void;
};

export type DesktopShell = Pick<PlasticineDesktopBridge, 'version' | 'platform' | 'server' | 'updates' | 'device'
  | 'notifications'>;

export function desktopShell(): DesktopShell | null {
  const bridge = (window as DesktopWindow).plasticineDesktop;
  if (bridge?.server === undefined || bridge.updates === undefined || bridge.device === undefined
    || bridge.notifications === undefined || bridge.version === undefined || bridge.platform === undefined) {
    return null;
  }
  return bridge as DesktopShell;
}

export function computerName(shell: DesktopShell): string {
  return shell.platform === 'macos' ? '这台 Mac' : '这台电脑';
}

export function listenDesktopEvents(): void {
  const host = window as DesktopWindow;
  host.__plasticineDesktopEvent ??= (event: unknown) => {
    if (Value.Check(DesktopEventSchema, event)) {
      window.dispatchEvent(new CustomEvent<DesktopEvent>(DESKTOP_EVENT, { detail: event }));
    }
  };
}

export interface DesktopState {
  server: ServerStatus | null;
  update: UpdateStatus | null;
  device: DeviceServiceStatus | null;
  notifications: boolean | null;
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
    listenDesktopEvents();
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
    window.addEventListener(DESKTOP_EVENT, receive);
    return () => {
      alive = false;
      window.removeEventListener(DESKTOP_EVENT, receive);
    };
  }, [shell]);
  return [state, change];
}
