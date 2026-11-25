import { isComputerPlatform, type DeviceActionKind, type DeviceNode } from '../../shared/state.ts';
import { nodeOnline } from './holds.ts';

export const DEVICE_PLACES = ['cloud', 'mac', 'wait_mac'] as const;
export type DevicePlace = (typeof DEVICE_PLACES)[number];

export const BROWSE_KINDS: readonly DeviceActionKind[] = ['browser_open', 'browser_read', 'tab_open',
  'tab_navigate', 'tab_read', 'tab_perceive'];

export interface PlaceChoice {
  place: DevicePlace;
  nodeId: string | null;
  reason: string;
}

export const PLACE_REASONS: Readonly<Record<DevicePlace, string>> = {
  mac: '在电脑上用你的登录做',
  cloud: '不用登录的网页，云端先做',
  wait_mac: '要用你在电脑上的登录；电脑上线就接着做',
};

function capable(node: DeviceNode, kind: DeviceActionKind, now: Date): boolean {
  return node.revokedAt === null && node.capabilities.includes(kind) && nodeOnline(node, now);
}

export function choosePlace(kind: DeviceActionKind, needsLogin: boolean, nodes: readonly DeviceNode[],
  now: Date): PlaceChoice {
  const mac = nodes.find((node) => isComputerPlatform(node.platform) && capable(node, kind, now));
  if (mac !== undefined) {
    return { place: 'mac', nodeId: mac.id, reason: PLACE_REASONS.mac };
  }
  if (BROWSE_KINDS.includes(kind) && !needsLogin) {
    return { place: 'cloud', nodeId: null, reason: PLACE_REASONS.cloud };
  }
  return { place: 'wait_mac', nodeId: null, reason: PLACE_REASONS.wait_mac };
}
