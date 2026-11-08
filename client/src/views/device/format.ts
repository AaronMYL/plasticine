// 设备与度量页上的时间：按这台设备的时区显示，月-日 时:分（数字一律等宽，样式在 device.css）。

import { formatClock } from '../../primitives/message/index.tsx';

export function localTime(iso: string, timeZone?: string): string {
  return formatClock(iso, true, timeZone);
}
