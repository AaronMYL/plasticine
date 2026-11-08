// 第 102 条「设备失败先分类」：派发前就看得出来的几种情况，不发出去，也不当失败。
// - 离线（iPhone 除外：它的动作本来就排队到下次打开 App）→ 这一步不发，等它上线；
// - 能力缺失（hello 没报这项能力，多半是没给屏幕录制 / 辅助功能权限）→ 派发前就拒，告诉他去系统设置打开；
// - 别的线正在截图 / 点击 / 输入（租约）→ 等；
// - 用户正在用（hello 报的空闲秒数）→ 点击 / 输入等。
// 2026-11-05 Harness 重做：租约按线算（run_id = line:<线>），不再按任务。

import { NODE_ONLINE_MS } from '../../shared/api/index.ts';
import type { DeviceActionKind, DeviceNode } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';

export type HoldState = Pick<StateService, 'nodes' | 'nodeActions' | 'lines'>;

export type DeviceWaitReason = 'offline' | 'busy' | 'user_active';

export interface DeviceHold {
  why: DeviceWaitReason | 'capability_missing';
  nodeName: string;
  /** For a missing capability: what to switch on (屏幕录制 / 辅助功能) or what else to do. */
  remedy: string | null;
}

// 租约：一条线最后一次截图 / 点击 / 输入之后两分钟内，这台节点的屏幕归它（一串「截图 → 点击 → 再截图」不被插队）。
export const INPUT_LEASE_MS = 2 * 60_000;
export const LEASED_KINDS = ['screen_capture', 'input_click', 'input_type'] as const;
// 用户在场让路只管点击和输入；截图不抢用户的键鼠。
export const PRESENCE_KINDS = ['input_click', 'input_type'] as const;
// 最近 30 秒内动过键鼠算「正在用」。
export const USER_ACTIVE_IDLE_SECONDS = 30;
// hello 每 60 秒一次：两次没到（再留 10 秒余量）就当没报，照现状执行。
export const IDLE_REPORT_FRESH_MS = 2 * 60_000 + 10_000;
const LINE_RUN_PREFIX = 'line:';
// 占着屏幕的线还在这几种状态才算占着；停了、做完了的租约作废。
const HOLDING_STATUSES: readonly string[] = ['running', 'waiting'];

// 第 15 条（11-06 定）：Mac 不在线时，建日程、建提醒、标完成这几样排队到它上线再做（「排队并告诉他」），和 iPhone 一样
// 期限 24 小时；读日程、读提醒等它在线（不在线时首页和工具读缓存）。
export const OFFLINE_QUEUE_KINDS: readonly DeviceActionKind[] = ['calendar_create', 'reminder_create',
  'reminder_complete'];

/** 这台节点现在发这一种动作是排进队列等它下次上线（iPhone 一律如此，Mac 只是离线时的那几样）。 */
export function queuesUntilOnline(node: DeviceNode, kind: DeviceActionKind, now: Date): boolean {
  return node.platform === 'ios' || OFFLINE_QUEUE_KINDS.includes(kind) && !nodeOnline(node, now);
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

/** 另一条还在跑的线两分钟内在这台节点上截图、点击或输入过：它的 run id；没有是 null。 */
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
  input_click: '辅助功能',
  input_type: '辅助功能',
  // iPhone（第 4 批）：没报这些能力多半是没给对应的隐私权限（设置 → 隐私与安全性）。
  calendar_list: '日历（完全访问）',
  calendar_create: '日历（完全访问）',
  reminder_list: '提醒事项',
  reminder_create: '提醒事项',
  reminder_complete: '提醒事项',
  photo_list: '照片',
  photo_read: '照片',
  location_current: '定位',
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
