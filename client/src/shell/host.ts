import { Value } from 'typebox/value';
import {
  HostProfileSchema, type HostProfile, type PlasticineDesktopExternal, type PlasticineDesktopServer,
  type PlasticineMacLogins, type PlasticineMacTranslate, type PlasticineMacWebTabs,
  type PlasticineMacWindowChrome,
} from '../api/shared.ts';
import type { HostBridge } from '../mac/bridge.ts';
import type { DesktopHelperBridge } from '../mac/desktop-helper.ts';
import '../mac/bridge.ts';

export type HostKind = 'desktop' | 'web';

const DESKTOP_AGENT = /(?:^|\s)PlasticineDesktop\/[^\s]+(?:\s|$)/;

function bridge(): HostBridge | undefined {
  return window.plasticineDesktop;
}

export function hostKind(): HostKind {
  if (bridge() !== undefined || DESKTOP_AGENT.test(navigator.userAgent)) return 'desktop';
  return 'web';
}

export function inDesktopApp(): boolean {
  return hostKind() === 'desktop';
}

export function hostWebTabs(): PlasticineMacWebTabs | null {
  return bridge()?.webTabs ?? null;
}

export function hostWindowChrome(): PlasticineMacWindowChrome | null {
  return bridge()?.windowChrome ?? null;
}

export function hostTranslate(): PlasticineMacTranslate | null {
  return bridge()?.translate ?? null;
}

export function hostLogins(): PlasticineMacLogins | null {
  return bridge()?.logins ?? null;
}

type DesktopExtras = { server?: Partial<PlasticineDesktopServer>; external?: Partial<PlasticineDesktopExternal> };

function extras(): DesktopExtras | undefined {
  return bridge() as DesktopExtras | undefined;
}

export async function hostLocalGrant(): Promise<string | null> {
  const server = extras()?.server;
  if (server?.localGrant === undefined) {
    return null;
  }
  try {
    const token = await server.localGrant();
    return typeof token === 'string' && token !== '' ? token : null;
  } catch (cause) {
    console.warn('桌面客户端没给本机令牌', cause);
    return null;
  }
}

export async function hostProfile(): Promise<HostProfile | null> {
  const server = extras()?.server;
  if (server?.profile === undefined) {
    return null;
  }
  try {
    const value: unknown = await server.profile();
    return Value.Check(HostProfileSchema, value) ? value : null;
  } catch (cause) {
    console.warn('桌面客户端没给系统全名和应用', cause);
    return null;
  }
}

export function hostShowWelcome(): (() => void) | null {
  const server = extras()?.server;
  const show = server?.showWelcome;
  return show === undefined ? null : () => show.call(server);
}

export function hostExternal(): PlasticineDesktopExternal | null {
  const external = extras()?.external;
  if (external?.open === undefined || external.capture === undefined || external.cancelCapture === undefined) {
    return null;
  }
  return external as PlasticineDesktopExternal;
}

export function hostHelper(): DesktopHelperBridge | null {
  return bridge()?.helper ?? null;
}

export function hostNotify(title: string, body: string, hash: string): void {
  const desktop = bridge();
  if (desktop === undefined) {
    throw new Error('桌面客户端的通知还没就绪');
  }
  desktop.notify(title, body, hash);
}
