// 转写前先拉平音量（11-18 Aaron 定）：一段手机放包里录的 99 分钟现场录音，内置转写把轻声的地方当成没人说话跳过了；
// Plasticine 临时写脚本先拉平音量（高通滤掉低频闷响 + 动态音量均衡）再用同一个引擎补转，补完「几乎能听清的都转进去了」。
// 做成三档：on 拉平、off 不拉平、auto 先量音量，明显太轻才拉平。默认抖音 off（声音本来就清楚），其他 auto；
// AI 能指定（audio_transcribe、video_parse 的 leveling 参数）。转完附上「转出来多少」（coverage），AI 看数决定要不要
// 换一档再转。

import { createReadStream } from 'node:fs';
import type { TRANSCRIBE_LEVELINGS } from '../../shared/api/video.ts';
import { wavDataStart } from './wav.ts';

export type Leveling = (typeof TRANSCRIBE_LEVELINGS)[number];

/** Plasticine 那次补转用的同一组：滤掉 100Hz 以下的闷响，再按 250ms 一帧把音量拉齐（最多放大 15 倍）。 */
export const LEVELING_FILTER = 'highpass=f=100,dynaudnorm=f=250:g=15';

/** auto 时：响的那些秒（九成分位）都不到 -24 dBFS，或者一半的秒都不到 -35 dBFS，算太轻（11-18 先这么定，看用下来再调）。 */
const LOUD_FLOOR_DB = -24;
const MEDIAN_FLOOR_DB = -35;
const SAMPLES_PER_SECOND = 16_000;

export interface Loudness {
  /** 一秒一秒算的音量（dBFS），一半的秒比这个轻。 */
  medianDb: number;
  /** 九成的秒比这个轻（响的那些有多响）。 */
  loudDb: number;
}

function quantile(sorted: readonly number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? -120;
}

/** 16kHz 单声道 16 位 wav 一秒一秒的音量；边读边算，长录音也不整个读进内存。 */
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
  /** 转出几句。 */
  lines: number;
  /** 第一句在第几秒。 */
  firstAt: number | null;
  /** 最长一段没字：从第几秒起、多长（句子之间、开头、结尾都算）。 */
  longestGap: { from: number; seconds: number } | null;
}

/** 从转出来的句子（只有开始时间）算「转出来多少」。 */
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

/** 给模型看的一句：转出几句、第一句在哪、最长一段没字在哪，和这次拉没拉平。 */
export function coverageText(coverage: Coverage, leveled: boolean): string {
  const gap = coverage.longestGap;
  return [`转出 ${String(coverage.lines)} 句`,
    ...(coverage.firstAt === null ? [] : [`第一句在 ${clock(coverage.firstAt)}`]),
    ...(gap === null ? [] : [`最长一段没字 ${clock(gap.seconds)}（从 ${clock(gap.from)} 起）`]),
    leveled ? '这次先拉平了音量' : '这次没拉平音量'].join('；')
    + '。空白多、句子碎，可能是声音太轻没认出来：换 leveling 再转一遍。';
}

/** 「[mm:ss] 一句话」一行一句的逐字稿 → 每句的开始秒数。 */
export function transcriptStarts(text: string): number[] {
  return text.split('\n').flatMap((line) => {
    const match = /^\[(?:(\d+):)?(\d+):(\d+)\]/u.exec(line);
    return match === null ? [] : [Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3])];
  });
}
