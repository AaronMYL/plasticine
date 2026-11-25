import { DEVICE_KIND_CLASSES, DEVICE_KIND_LABELS, type DeviceActionParams } from '../../../agent/shared/api/index.ts';
import { classifyLane } from '../../../agent/shared/device-lanes.ts';
import type { DeviceActionClass, DeviceLimits } from '../../../agent/shared/state.ts';

const HOUR_MS = 60 * 60 * 1000;

export type GuardDecision =
  | { kind: 'allow' }
  | { kind: 'confirm'; reason: string }
  | { kind: 'refuse'; reason: string };

function siteAllowed(url: string, sites: readonly string[]): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch (error) {
    if (error instanceof TypeError) {
      return false;
    }
    throw error;
  }
  return sites.some((site) => {
    const wanted = site.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    return host === wanted || host.endsWith(`.${wanted}`);
  });
}

function outOfScope(action: DeviceActionParams, limits: DeviceLimits): string | null {
  if (action.kind === 'app_open' && limits.apps.length > 0 && !limits.apps.includes(action.app)) {
    return `「${action.app}」不在设备上限的应用清单里。`;
  }
  const url = 'url' in action && typeof action.url === 'string' ? action.url : null;
  if (url !== null && limits.sites.length > 0 && !siteAllowed(url, limits.sites)) {
    return '这个网站不在设备上限的站点清单里。';
  }
  return null;
}

export class DeviceGuard {
  private readonly history = new Map<DeviceActionClass, number[]>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  decide(action: DeviceActionParams, limits: DeviceLimits): GuardDecision {
    const label = DEVICE_KIND_LABELS[action.kind];
    const lane = classifyLane(action, '');
    if (lane.lane === 'deny') {
      if (limits.payments !== 'confirm_each') {
        return { kind: 'refuse', reason: lane.reason };
      }
      return { kind: 'confirm', reason: `${label}：像是付款、下单或转账，你在上限里放开成了每次问你。` };
    }
    const actionClass = DEVICE_KIND_CLASSES[action.kind];
    const limit = limits.classes[actionClass];
    if (limit.mode === 'deny') {
      return { kind: 'refuse', reason: `${label}：这一类在设备上限里关着。` };
    }
    const scope = outOfScope(action, limits);
    if (scope !== null) {
      return { kind: 'refuse', reason: `${label}：${scope}` };
    }
    const recent = this.recent(actionClass);
    if (recent.length >= limit.perHour) {
      return { kind: 'refuse', reason: `${label}：这一小时已经做了 ${recent.length} 次，到了设备上限。` };
    }
    if (lane.lane === 'confirm') {
      return { kind: 'confirm', reason: lane.reason };
    }
    if (action.kind === 'file_delete') {
      return { kind: 'confirm', reason: `删除「${action.path}」：删了挪进废纸篓。` };
    }
    if (limit.mode === 'confirm_each') {
      return { kind: 'confirm', reason: `${label}：这一类在设备上限里设成了每次问你。` };
    }
    return { kind: 'allow' };
  }

  record(action: DeviceActionParams): void {
    const actionClass = DEVICE_KIND_CLASSES[action.kind];
    this.history.set(actionClass, [...this.recent(actionClass), this.now()]);
  }

  private recent(actionClass: DeviceActionClass): number[] {
    const since = this.now() - HOUR_MS;
    return (this.history.get(actionClass) ?? []).filter((time) => time > since);
  }
}
