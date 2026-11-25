import { TITLEBAR_HEIGHT } from '../../../agent/shared/api/mac-bridge.ts';

const LIGHT_SIZE = 14;
const LEFT = 20;
const GAP_AFTER = 14;
const WIDTH_TAHOE = 62;
const WIDTH_BEFORE = 54;

export interface TrafficLights {
  position: { x: number; y: number };
  inset: number;
}

function tahoe(systemVersion: string): boolean {
  const major = Number.parseInt(systemVersion.split('.')[0] ?? '', 10);
  return major >= 26 || major === 16;
}

export function macTrafficLights(systemVersion: string): TrafficLights {
  const width = tahoe(systemVersion) ? WIDTH_TAHOE : WIDTH_BEFORE;
  return { position: { x: LEFT, y: (TITLEBAR_HEIGHT - LIGHT_SIZE) / 2 }, inset: LEFT + width + GAP_AFTER };
}
