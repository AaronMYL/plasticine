import { createReadStream } from 'node:fs';
import type { TRANSCRIBE_LEVELINGS } from '../../shared/api/video.ts';
import { wavDataStart } from './wav.ts';

export type Leveling = (typeof TRANSCRIBE_LEVELINGS)[number];

export const LEVELING_FILTER = 'highpass=f=100,dynaudnorm=f=250:g=15';

const LOUD_FLOOR_DB = -24;
const MEDIAN_FLOOR_DB = -35;
const SAMPLES_PER_SECOND = 16_000;

export interface Loudness {
  medianDb: number;
  loudDb: number;
}

function quantile(sorted: readonly number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? -120;
}

export async function wavLoudness(path: string): Promise<Loudness | null> {
  const start = await wavDataStart(path);
  if (start === null) {
    return null;
  }
  const seconds: number[] = [];
  let sum = 0;
  let count = 0;
  let carry: Buffer | null = null;
  for await (const piece of createReadStream(path, { start, highWaterMark: 1 << 20 })) {
    let chunk = piece as Buffer;
    if (carry !== null) {
      chunk = Buffer.concat([carry, chunk]);
      carry = null;
    }
    const even = chunk.length - (chunk.length % 2);
    for (let at = 0; at < even; at += 2) {
      const sample = chunk.readInt16LE(at) / 32_768;
      sum += sample * sample;
      count += 1;
      if (count === SAMPLES_PER_SECOND) {
        seconds.push(10 * Math.log10(sum / count + 1e-12));
        sum = 0;
        count = 0;
      }
    }
    if (even < chunk.length) {
      carry = chunk.subarray(even);
    }
  }
  if (seconds.length === 0) {
    return null;
  }
  const sorted = [...seconds].sort((left, right) => left - right);
  return { medianDb: quantile(sorted, 0.5), loudDb: quantile(sorted, 0.9) };
}

export function tooQuiet(loudness: Loudness): boolean {
  return loudness.loudDb < LOUD_FLOOR_DB || loudness.medianDb < MEDIAN_FLOOR_DB;
}

export interface Coverage {
  lines: number;
  firstAt: number | null;
  longestGap: { from: number; seconds: number } | null;
}

export function coverageOf(starts: readonly number[], totalSeconds: number | null): Coverage {
  const sorted = [...starts].sort((left, right) => left - right);
  const marks = [0, ...sorted, ...(totalSeconds === null ? [] : [totalSeconds])];
  let longest: { from: number; seconds: number } | null = null;
  for (let index = 1; index < marks.length; index += 1) {
    const gap = marks[index]! - marks[index - 1]!;
    if (longest === null || gap > longest.seconds) {
      longest = { from: marks[index - 1]!, seconds: Math.round(gap) };
    }
  }
  return { lines: sorted.length, firstAt: sorted[0] ?? null, longestGap: longest };
}

function clock(seconds: number): string {
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = String(Math.floor((whole % 3600) / 60)).padStart(2, '0');
  const rest = String(whole % 60).padStart(2, '0');
  return hours > 0 ? `${String(hours)}:${minutes}:${rest}` : `${minutes}:${rest}`;
}

export function coverageText(coverage: Coverage, leveled: boolean): string {
  const gap = coverage.longestGap;
  return [`转出 ${String(coverage.lines)} 句`,
    ...(coverage.firstAt === null ? [] : [`第一句在 ${clock(coverage.firstAt)}`]),
    ...(gap === null ? [] : [`最长一段没字 ${clock(gap.seconds)}（从 ${clock(gap.from)} 起）`]),
    leveled ? '这次先拉平了音量' : '这次没拉平音量'].join('；')
    + '。空白多、句子碎，可能是声音太轻没认出来：换 leveling 再转一遍。';
}

export function transcriptStarts(text: string): number[] {
  return text.split('\n').flatMap((line) => {
    const match = /^\[(?:(\d+):)?(\d+):(\d+)\]/u.exec(line);
    return match === null ? [] : [Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3])];
  });
}
