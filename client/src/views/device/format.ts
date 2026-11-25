import { formatClock } from '../../primitives/message/index.tsx';

export function localTime(iso: string, timeZone?: string): string {
  return formatClock(iso, true, timeZone);
}
