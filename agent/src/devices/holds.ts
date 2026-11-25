import { NODE_ONLINE_MS } from '../../shared/api/index.ts';
import type { DeviceActionKind, DeviceNode } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';

export type HoldState = Pick<StateService, 'nodes' | 'nodeActions' | 'lines'>;

export type DeviceWaitReason = 'offline' | 'busy' | 'user_active';

export interface DeviceHold {
  why: DeviceWaitReason | 'capability_missing';
  nodeName: string;
  remedy: string | null;
}

export const INPUT_LEASE_MS = 2 * 60_000;
export const LEASED_KINDS = ['screen_capture', 'screen_zoom', 'window_capture', 'input_click', 'input_type',
  'input_key', 'input_scroll', 'input_mouse'] as const;
export const PRESENCE_KINDS = ['input_click', 'input_type', 'input_key', 'input_scroll', 'input_mouse',
  'window_act'] as const;
export const USER_ACTIVE_IDLE_SECONDS = 30;
export const IDLE_REPORT_FRESH_MS = 2 * 60_000 + 10_000;
const LINE_RUN_PREFIX = 'line:';
const HOLDING_STATUSES: readonly string[] = ['running', 'waiting'];

export const OFFLINE_QUEUE_KINDS: readonly DeviceActionKind[] = ['calendar_create', 'reminder_create',
  'reminder_complete'];

export function queuesUntilOnline(node: DeviceNode, kind: DeviceActionKind, now: Date): boolean {
  return OFFLINE_QUEUE_KINDS.includes(kind) && !nodeOnline(node, now);
}

export function nodeOnline(node: DeviceNode, now: Date): boolean {
  return node.revokedAt === null && now.getTime() - Date.parse(node.lastSeenAt) <= NODE_ONLINE_MS;
}

/** The user moved the mouse or typed within the last half minute, by a report fresh enough to trust. */
export function userActive(node: DeviceNode, now: Date): boolean {
  if (node.idleSeconds === null || node.idleReportedAt === null) {
    return false;
  }
  if (now.getTime() - Date.parse(node.idleReportedAt) > IDLE_REPORT_FRESH_MS) {
    return false;
  }
  return node.idleSeconds < USER_ACTIVE_IDLE_SECONDS;
}

export function inputLeaseHolder(state: HoldState, nodeId: string, runId: string | null, now: Date): string | null {
  const since = new Date(now.getTime() - INPUT_LEASE_MS).toISOString();
  const latest = state.nodeActions.latestOfKinds(nodeId, LEASED_KINDS, since);
  if (latest === undefined || latest.runId === null || latest.runId === runId
    || !latest.runId.startsWith(LINE_RUN_PREFIX)) {
    return null;
  }
  const line = state.lines.get(latest.runId.slice(LINE_RUN_PREFIX.length));
  return line !== undefined && HOLDING_STATUSES.includes(line.status) ? latest.runId : null;
}

const REMEDIES: Partial<Readonly<Record<DeviceActionKind, string>>> = {
  screen_capture: '屏幕录制',
  screen_zoom: '屏幕录制',
  window_capture: '屏幕录制',
  input_click: '辅助功能',
  input_type: '辅助功能',
  input_key: '辅助功能',
  input_scroll: '辅助功能',
  input_mouse: '辅助功能',
  window_list: '辅助功能',
  window_act: '辅助功能',
  app_perceive: '辅助功能',
  app_act: '辅助功能',
  app_menu: '辅助功能',
  calendar_update: '日历（完全访问）',
  calendar_list: '日历（完全访问）',
  calendar_create: '日历（完全访问）',
  reminder_list: '提醒事项',
  reminder_create: '提醒事项',
  reminder_complete: '提醒事项',
};

function includes(kinds: readonly string[], kind: string): boolean {
  return kinds.includes(kind);
}

/** Why the action should wait or ask before it is sent, or null when it may go out now. */
export function holdFor(state: HoldState, node: DeviceNode | undefined, kind: DeviceActionKind,
  runId: string | null, now: Date): DeviceHold | null {
  if (node === undefined || node.revokedAt !== null) {
    return null;
  }
  if (!node.capabilities.includes(kind)) {
    return { why: 'capability_missing', nodeName: node.name, remedy: REMEDIES[kind] ?? null };
  }
  if (!queuesUntilOnline(node, kind, now) && !nodeOnline(node, now)) {
    return { why: 'offline', nodeName: node.name, remedy: null };
  }
  if (includes(LEASED_KINDS, kind) && inputLeaseHolder(state, node.id, runId, now) !== null) {
    return { why: 'busy', nodeName: node.name, remedy: null };
  }
  if (includes(PRESENCE_KINDS, kind) && userActive(node, now)) {
    return { why: 'user_active', nodeName: node.name, remedy: null };
  }
  return null;
}
