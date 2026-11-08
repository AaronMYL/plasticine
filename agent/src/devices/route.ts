// 任务要用浏览器、Mac 没开时在哪做（2026-11-04 第 3 批，他的原话）：「不用登录的网页云端先做；登录不上的等 Mac；
// iPhone 在线且 iPhone 能做的，也可以在 iPhone 上做」。这里把这句话写成代码，设备动作的门槛在节点离线时照它分路
// （brain/tools/device-action.ts）：
// 1. Mac 在线、会这一步 → Mac（他的登录在 Mac 上 Plasticine 的浏览器里）。
// 2. iPhone 在线、报了这项能力 → iPhone。
// 3. 只是看网页（开、换地址、读、感知）、不用他的登录 → 云端浏览器先做。
// 4. 其余（要他的登录、要在页面上点和填）→ 等 Mac。
// 「要不要登录」由脑在动作上写明（needsLogin）；没写当作不要——判错了的代价是云端打开看到登录页，再改等 Mac。

import type { DeviceActionKind, DeviceNode } from '../../shared/state.ts';
import { nodeOnline } from './holds.ts';

// 原来和任务的「在哪做」共用（shared/api/tasks.ts），2026-11-05 任务删了，搬到这里。
export const DEVICE_PLACES = ['cloud', 'iphone', 'mac', 'wait_mac'] as const;
export type DevicePlace = (typeof DEVICE_PLACES)[number];

/** 只是看网页的几种：云端浏览器也做得到。 */
export const BROWSE_KINDS: readonly DeviceActionKind[] = ['browser_open', 'browser_read', 'tab_open',
  'tab_navigate', 'tab_read', 'tab_perceive'];

export interface PlaceChoice {
  place: DevicePlace;
  /** 去 Mac / iPhone 时是那台节点；云端和等 Mac 是 null。 */
  nodeId: string | null;
  /** 一句理由（任务行的浮框、给脑的说明）。 */
  reason: string;
}

export const PLACE_REASONS: Readonly<Record<DevicePlace, string>> = {
  mac: '在 Mac 上用你的登录做',
  iphone: 'iPhone 在线，这一步 iPhone 能做',
  cloud: '不用登录的网页，云端先做',
  wait_mac: '要用你在 Mac 上的登录；Mac 上线就接着做',
};

function capable(node: DeviceNode, kind: DeviceActionKind, now: Date): boolean {
  return node.revokedAt === null && node.capabilities.includes(kind) && nodeOnline(node, now);
}

/** 这一步该在哪做；nodes 是配对过的全部节点。 */
export function choosePlace(kind: DeviceActionKind, needsLogin: boolean, nodes: readonly DeviceNode[],
  now: Date): PlaceChoice {
  const mac = nodes.find((node) => node.platform === 'macos' && capable(node, kind, now));
  if (mac !== undefined) {
    return { place: 'mac', nodeId: mac.id, reason: PLACE_REASONS.mac };
  }
  const phone = nodes.find((node) => node.platform === 'ios' && capable(node, kind, now));
  if (phone !== undefined) {
    return { place: 'iphone', nodeId: phone.id, reason: PLACE_REASONS.iphone };
  }
  if (BROWSE_KINDS.includes(kind) && !needsLogin) {
    return { place: 'cloud', nodeId: null, reason: PLACE_REASONS.cloud };
  }
  return { place: 'wait_mac', nodeId: null, reason: PLACE_REASONS.wait_mac };
}
