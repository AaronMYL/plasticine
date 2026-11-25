import { Type, type Static } from 'typebox';
import { IsoTimeSchema } from './common.ts';
import type { PlasticineMacLogins } from './mac-logins.ts';
import type { PlasticineMacTranslate } from './mac-translate.ts';
import type { PlasticineMacWebTabs, PlasticineMacWindowChrome } from './mac-bridge.ts';

const STRICT = { additionalProperties: false };

export const DESKTOP_PLATFORMS = ['macos', 'windows', 'linux'] as const;
export const DesktopPlatformSchema = Type.Enum(DESKTOP_PLATFORMS);
export type DesktopPlatform = Static<typeof DesktopPlatformSchema>;

export const SERVER_MODES = ['this_computer', 'remote'] as const;
export const ServerModeSchema = Type.Enum(SERVER_MODES);
export type ServerMode = Static<typeof ServerModeSchema>;

export const REMOTE_URL_MAX_CHARS = 300;

export const ServerChoiceSchema = Type.Object({
  mode: ServerModeSchema,
  remoteUrl: Type.Union([Type.String({ minLength: 1, maxLength: REMOTE_URL_MAX_CHARS }), Type.Null()]),
}, STRICT);
export type ServerChoice = Static<typeof ServerChoiceSchema>;

export const LOCAL_SERVER_STATES = ['stopped', 'starting', 'running', 'failed', 'absent'] as const;
export type LocalServerState = (typeof LOCAL_SERVER_STATES)[number];

export const ServerStatusSchema = Type.Object({
  choice: ServerChoiceSchema,
  bundled: Type.Boolean(),
  local: Type.Enum(LOCAL_SERVER_STATES),
  problem: Type.Union([Type.String({ maxLength: 300 }), Type.Null()]),
  loaded: Type.String({ maxLength: REMOTE_URL_MAX_CHARS }),
}, STRICT);
export type ServerStatus = Static<typeof ServerStatusSchema>;

export const UPDATE_STATES = ['idle', 'checking', 'available', 'downloading', 'ready', 'installing', 'failed',
  'up_to_date'] as const;

export const UpdateStatusSchema = Type.Object({
  version: Type.String({ maxLength: 40 }),
  state: Type.Enum(UPDATE_STATES),
  available: Type.Union([Type.String({ maxLength: 40 }), Type.Null()]),
  previous: Type.Union([Type.String({ maxLength: 40 }), Type.Null()]),
  checkedAt: Type.Union([IsoTimeSchema, Type.Null()]),
  problem: Type.Union([Type.String({ maxLength: 300 }), Type.Null()]),
  progress: Type.Optional(Type.Union([Type.Object({ received: Type.Integer({ minimum: 0 }),
    total: Type.Integer({ minimum: 0 }) }, STRICT), Type.Null()])),
}, STRICT);
export type UpdateStatus = Static<typeof UpdateStatusSchema>;

export const DEVICE_SERVICE_STATES = ['unpaired', 'connecting', 'online', 'paused', 'repair', 'offline'] as const;

export const DeviceServiceStatusSchema = Type.Object({
  state: Type.Enum(DEVICE_SERVICE_STATES),
  server: Type.Union([Type.String({ maxLength: REMOTE_URL_MAX_CHARS }), Type.Null()]),
  capabilities: Type.Array(Type.String({ maxLength: 40 }), { maxItems: 64 }),
  missing: Type.Array(Type.Enum(['screen', 'accessibility', 'calendar', 'reminders']), { maxItems: 4 }),
  problem: Type.Union([Type.String({ maxLength: 300 }), Type.Null()]),
}, STRICT);
export type DeviceServiceStatus = Static<typeof DeviceServiceStatusSchema>;

export const DevicePairRequestSchema = Type.Object({ code: Type.String({ minLength: 4, maxLength: 20 }) }, STRICT);
export type DevicePairRequest = Static<typeof DevicePairRequestSchema>;

export const DesktopEventSchema = Type.Union([
  Type.Object({ type: Type.Literal('server'), status: ServerStatusSchema }, STRICT),
  Type.Object({ type: Type.Literal('update'), status: UpdateStatusSchema }, STRICT),
  Type.Object({ type: Type.Literal('device'), status: DeviceServiceStatusSchema }, STRICT),
]);
export type DesktopEvent = Static<typeof DesktopEventSchema>;

export const WEB_TAB_ICON_MAX_BYTES = 64 * 1024;
export const WEB_TAB_ICON_TYPES = ['image/png', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/svg+xml',
  'image/jpeg', 'image/gif', 'image/webp'] as const;

export const WebTabIconEventSchema = Type.Object({
  type: Type.Literal('icon'),
  tabId: Type.String({ minLength: 1, maxLength: 100 }),
  pageUrl: Type.String({ maxLength: 4_096 }),
  icon: Type.String({ pattern: '^data:image/', maxLength: Math.ceil(WEB_TAB_ICON_MAX_BYTES / 3) * 4 + 100 }),
}, STRICT);
export type WebTabIconEvent = Static<typeof WebTabIconEventSchema>;

export const DESKTOP_PERMISSIONS = ['screen', 'accessibility', 'calendar', 'reminders', 'notifications'] as const;
export type DesktopPermission = (typeof DESKTOP_PERMISSIONS)[number];

export const ONBOARDING_APPS = ['obsidian', 'notion', 'bear', 'evernote', 'logseq', 'apple-notes'] as const;
export type OnboardingApp = (typeof ONBOARDING_APPS)[number];

export const HostProfileSchema = Type.Object({
  fullName: Type.Union([Type.String({ minLength: 1, maxLength: 100 }), Type.Null()]),
  apps: Type.Array(Type.Enum(ONBOARDING_APPS), { maxItems: ONBOARDING_APPS.length }),
}, STRICT);
export type HostProfile = Static<typeof HostProfileSchema>;

export interface PlasticineDesktopServer {
  status(): Promise<unknown>;
  choose(choice: ServerChoice): Promise<unknown>;
  localGrant(): Promise<string | null>;
  showWelcome(): void;
  profile(): Promise<unknown>;
}

export interface PlasticineDesktopExternal {
  open(url: string): void;
  capture(port: number, timeoutMs: number): Promise<string | null>;
  cancelCapture(): void;
}

export interface PlasticineDesktopUpdates {
  status(): Promise<unknown>;
  check(): Promise<unknown>;
  download(): Promise<unknown>;
  install(): void;
  rollback(): void;
}

export interface PlasticineDesktopDevice {
  status(): Promise<unknown>;
  pair(request: DevicePairRequest): Promise<unknown>;
  pause(paused: boolean): Promise<unknown>;
  openPermission(permission: DesktopPermission): void;
}

export interface PlasticineDesktopHelper {
  call(method: string, params: Record<string, unknown>): Promise<unknown>;
}

export interface PlasticineDesktopRender {
  page(html: string, format: 'pdf' | 'png'): Promise<unknown>;
}
export const RENDER_HTML_MAX_CHARS = 40 * 1024 * 1024;

export interface PlasticineDesktopBridge {
  version: string;
  platform: DesktopPlatform;
  notify(title: string, body: string, hash: string): void;
  notifications: { enabled(): Promise<unknown>; setEnabled(enabled: boolean): Promise<unknown>;
    test?(): Promise<unknown>; openSettings?(): void };
  webTabs: PlasticineMacWebTabs;
  windowChrome: PlasticineMacWindowChrome;
  translate: PlasticineMacTranslate;
  logins: PlasticineMacLogins;
  server: PlasticineDesktopServer;
  updates: PlasticineDesktopUpdates;
  device: PlasticineDesktopDevice;
  helper: PlasticineDesktopHelper;
  external: PlasticineDesktopExternal;
  render?: PlasticineDesktopRender;
}
