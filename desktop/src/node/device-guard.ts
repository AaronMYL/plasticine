// 设备是最后一道墙（第 102 条）：动作到了设备上，按本体同一套三条道（agent/shared/device-lanes.ts）和用户设的设备上限
// 再判一次，判不准从严。付款 / 下单 / 转账默认关死（上限的 payments 缺省或 deny 直接拒；只有放开成 confirm_each 才降为
// 在这台电脑上弹一次确认）；读密码、改系统设置弹一次确认；删除每次都问。上限的路径范围在执行时核（path-policy.ts）。
// 这里只判，不弹框：要确认的由调用方弹原生对话框（默认按钮是「不做」）。

import { DEVICE_KIND_CLASSES, DEVICE_KIND_LABELS, type DeviceActionParams } from '../../../agent/shared/api/index.ts';
import { classifyLane } from '../../../agent/shared/device-lanes.ts';
import type { DeviceActionClass, DeviceLimits } from '../../../agent/shared/state.ts';

const HOUR_MS = 60 * 60 * 1000;

export type GuardDecision =
  | { kind: 'allow' }
  | { kind: 'confirm'; reason: string }
  | { kind: 'refuse'; reason: string };

/** 网址的主机在不在站点清单里（清单项是主机名，子域名也算）。 */
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

/** 云端设了应用、站点清单才按清单再限一层（空列表表示不另加限制，第 97 条）。 */
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

  /** 真做了（放行或他点了「做」）才记一次。 */
  record(action: DeviceActionParams): void {
    const actionClass = DEVICE_KIND_CLASSES[action.kind];
    this.history.set(actionClass, [...this.recent(actionClass), this.now()]);
  }

  private recent(actionClass: DeviceActionClass): number[] {
    const since = this.now() - HOUR_MS;
    return (this.history.get(actionClass) ?? []).filter((time) => time > since);
  }
}
