import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const COST = 16_384;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_BYTES = 64;
const SALT_BYTES = 16;
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
