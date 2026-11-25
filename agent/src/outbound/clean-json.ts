import { cleanOutboundText } from '../util/index.ts';

export { cleanOutboundText };

export type PreserveOutboundField = (parent: Readonly<Record<string, unknown>>, key: string) => boolean;

export function cleanOutboundJson<T>(value: T, preserve?: PreserveOutboundField): T {
  if (typeof value === 'string') {
    return cleanOutboundText(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry: unknown, index) => {
      const keep = typeof entry === 'string' && preserve?.(value as unknown as Record<string, unknown>, String(index));
      return keep ? entry : cleanOutboundJson(entry, preserve);
    }) as T;
  }
  if (typeof value === 'object' && value !== null) {
    const parent = value as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parent).map(([key, entry]) => {
      const keep = typeof entry === 'string' && preserve?.(parent, key);
      return [key, keep ? entry : cleanOutboundJson(entry, preserve)];
    })) as T;
  }
  return value;
}
