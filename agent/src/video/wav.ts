// 16kHz 单声道 16 位 wav 的两件小事（第13批）：装转写组件时试转用的一段静音；抽出来的音频有多长（读 data 块的大小，
// 不再另跑 ffprobe，组件里没带它）。

import { open } from 'node:fs/promises';

const RATE = 16_000;
const BYTES_PER_SECOND = RATE * 2;
/** 读文件头最多读这么多去找 data 块（ffmpeg 会在前面多写一个 LIST 块）。 */
const HEADER_SCAN_BYTES = 64 * 1024;

/** n 秒静音（16kHz 单声道 16 位）。 */
export function silentWav(seconds: number): Buffer {
  const data = Math.round(seconds * RATE) * 2;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(BYTES_PER_SECOND, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data, 40);
  return Buffer.concat([header, Buffer.alloc(data)]);
}

/** 文件头里的 data 块有多长 → 秒数；认不出是 null。 */
export function wavHeaderSeconds(head: Buffer): number | null {
  if (head.length < 12 || head.toString('ascii', 0, 4) !== 'RIFF' || head.toString('ascii', 8, 12) !== 'WAVE') {
    return null;
  }
  for (let at = 12; at + 8 <= head.length;) {
    const id = head.toString('ascii', at, at + 4);
    const size = head.readUInt32LE(at + 4);
    if (id === 'data') return Math.round(size / BYTES_PER_SECOND * 100) / 100;
    at += 8 + size + (size % 2);
  }
  return null;
}

export async function wavSeconds(path: string): Promise<number | null> {
  const file = await open(path, 'r');
  try {
    const head = Buffer.alloc(HEADER_SCAN_BYTES);
    const { bytesRead } = await file.read(head, 0, HEADER_SCAN_BYTES, 0);
    return wavHeaderSeconds(head.subarray(0, bytesRead));
  } finally {
    await file.close();
  }
}
