import { useEffect, useState } from 'react';
import { formatClock } from '../../primitives/message/states.ts';
import type { LineView } from '../../api/shared.ts';

const SECOND_MS = 1000;

export function elapsedText(ms: number): string {
  const total = Math.max(0, Math.floor(ms / SECOND_MS));
  const seconds = String(total % 60).padStart(2, '0');
  const minutes = Math.floor(total / 60);
  if (minutes < 60) {
    return `${minutes}:${seconds}`;
  }
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${seconds}`;
}

export function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) {
      return undefined;
    }
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), SECOND_MS);
    return () => clearInterval(timer);
  }, [ticking]);
  return now;
}

export function lineElapsed(line: Pick<LineView, 'activeSince'>, now: number): string | null {
  return line.activeSince === null ? null : elapsedText(now - Date.parse(line.activeSince));
}

export function pausedText(line: Pick<LineView, 'pausedUntil' | 'failure' | 'pauseReason'>, timeZone?: string): string {
  if (line.pauseReason === 'user') return '已暂停';
  if (line.pauseReason === 'stopped') return '已停止';
  if (line.pauseReason === 'output_limit') return '输出未完';
  if (line.pauseReason === 'quota' && line.pausedUntil !== null) {
    return `额度用完，${formatClock(line.pausedUntil, false, timeZone)} 后接着做`;
  }
  return line.failure ?? (line.pauseReason === 'quota' ? '额度用完，等待恢复' : '已暂停');
}

export function activityText(line: Pick<LineView, 'activity'>): string {
  return line.activity === null || line.activity.trim() === '' ? '在想…' : line.activity;
}
