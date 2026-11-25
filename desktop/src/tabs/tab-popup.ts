import type { Rectangle } from 'electron';

const DEFAULT_SIZE = { width: 500, height: 600 };
const MIN_SIZE = 100;

export interface OpenRequest {
  url: string;
  disposition: string;
  features: string;
}

export function isWeb(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function feature(features: string, names: readonly string[]): number | null {
  for (const name of names) {
    const match = new RegExp(`(?:^|[\\s,])${name}\\s*=\\s*(\\d+)`, 'i').exec(features);
    if (match !== null) {
      return Number(match[1]);
    }
  }
  return null;
}

export function popupSize(features: string): { width: number | null; height: number | null } {
  return { width: feature(features, ['width', 'innerWidth']), height: feature(features, ['height', 'innerHeight']) };
}

export function isPopupRequest(request: OpenRequest): boolean {
  if (!isWeb(request.url) && request.url !== 'about:blank' && request.url !== '') {
    return false;
  }
  const size = popupSize(request.features);
  return (request.disposition === 'new-window' && request.features.trim() !== '')
    || size.width !== null || size.height !== null;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high));
}

export function popupBounds(size: { width: number | null; height: number | null }, parent: Rectangle,
  workArea: Rectangle): Rectangle {
  const width = clamp(size.width ?? DEFAULT_SIZE.width, MIN_SIZE, workArea.width);
  const height = clamp(size.height ?? DEFAULT_SIZE.height, MIN_SIZE, workArea.height);
  const x = Math.round(parent.x + (parent.width - width) / 2);
  const y = Math.round(parent.y + (parent.height - height) / 2);
  return { x: clamp(x, workArea.x, workArea.x + workArea.width - width),
    y: clamp(y, workArea.y, workArea.y + workArea.height - height), width, height };
}
