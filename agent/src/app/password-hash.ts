// 主人密码的慢哈希（2026-11-08：密码只存在这份 Plasticine 里，加盐慢哈希）。node:crypto 的 scrypt，参数写进哈希串
// （scrypt$N$r$p$十六进制），以后调参数旧密码照样认；比对用 timingSafeEqual。异步算，不占住事件循环。

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// OWASP 给 scrypt 的建议值之一：N = 2^14、r = 8、p = 1，一次 16 MB 内存、几十毫秒。
const COST = 16_384;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_BYTES = 64;
const SALT_BYTES = 16;
// scrypt 要 128 · N · r 字节；默认的 32 MB 上限对以后更大的 N 不够，按参数给到两倍。
const MEMORY_PER_COST_BLOCK = 2 * 128;

export interface PasswordHash {
  hash: string;
  salt: string;
}

interface Params {
  N: number;
  r: number;
  p: number;
}

function derive(password: string, salt: Buffer, params: Params): Promise<Buffer> {
  const maxmem = MEMORY_PER_COST_BLOCK * params.N * params.r;
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFC'), salt, KEY_BYTES, { ...params, maxmem }, (error, key) => {
      if (error === null) {
        resolve(key);
      } else {
        reject(error);
      }
    });
  });
}

export async function hashPassword(password: string): Promise<PasswordHash> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, { N: COST, r: BLOCK_SIZE, p: PARALLELISM });
  return { hash: `scrypt$${COST}$${BLOCK_SIZE}$${PARALLELISM}$${key.toString('hex')}`, salt: salt.toString('hex') };
}

/** 密码对不对。哈希串坏了（不是这里写的格式）算不对，并抛错：库里的东西坏了要有人看见。 */
export async function verifyPassword(password: string, stored: PasswordHash): Promise<boolean> {
  const parts = stored.hash.split('$');
  const [scheme, cost, block, parallel, hex] = parts;
  if (parts.length !== 5 || scheme !== 'scrypt' || hex === undefined || !/^[0-9a-f]+$/.test(hex)) {
    throw new Error('库里的密码哈希格式不对');
  }
  const expected = Buffer.from(hex, 'hex');
  const key = await derive(password, Buffer.from(stored.salt, 'hex'), { N: Number(cost), r: Number(block),
    p: Number(parallel) });
  return key.length === expected.length && timingSafeEqual(key, expected);
}
