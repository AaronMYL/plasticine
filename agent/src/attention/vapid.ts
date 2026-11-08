// The server's VAPID key pair (RFC 8292), made once on the server and kept in the state directory with mode 0600
// (第 91 条 ⑤; 仓库规矩：密钥不进代码、日志、测试、提交). Browsers bind their subscriptions to the public key, so the
// pair must outlive restarts: it is created only when the file does not exist and never rewritten.

import { createECDH, randomUUID } from 'node:crypto';
import { chmod, link, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { generateVapidKeys, type VapidKeys } from './web-push-crypto.ts';

export const VAPID_KEY_FILE = 'web-push-vapid.json';
// Owner read / write only, like the subscription credential next to it.
const SECRET_FILE_MODE = 0o600;

const KEY_PATTERN = '^[A-Za-z0-9_-]+$';
const VapidFileSchema = Type.Object(
  { publicKey: Type.String({ pattern: KEY_PATTERN }), privateKey: Type.String({ pattern: KEY_PATTERN }) },
  { additionalProperties: false },
);

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function isTaken(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}

function checkPair(keys: VapidKeys, path: string): VapidKeys {
  const ecdh = createECDH('prime256v1');
  try {
    ecdh.setPrivateKey(Buffer.from(keys.privateKey, 'base64url'));
  } catch (error) {
    throw new Error(`${path} 里的 VAPID 私钥不是有效的 P-256 私钥`, { cause: error });
  }
  if (ecdh.getPublicKey().toString('base64url') !== keys.publicKey) {
    throw new Error(`${path} 里的 VAPID 公钥和私钥对不上；不要手改这个文件`);
  }
  return keys;
}

async function readKeys(path: string): Promise<VapidKeys | undefined> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (isMissing(error)) {
      return undefined;
    }
    throw new Error(`读不了 ${path}`, { cause: error });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${path} 不是合法的 JSON`, { cause: error });
  }
  if (!Value.Check(VapidFileSchema, parsed)) {
    throw new Error(`${path} 的格式不对（要 publicKey 和 privateKey 两项）`);
  }
  return checkPair(parsed, path);
}

/** The key pair in `directory`, made on first use. Concurrent first uses end with the same pair. */
export async function loadOrCreateVapidKeys(directory: string): Promise<VapidKeys> {
  const path = join(directory, VAPID_KEY_FILE);
  const existing = await readKeys(path);
  if (existing !== undefined) {
    return existing;
  }
  const keys = generateVapidKeys();
  // Written whole to a private temporary file first, then published under the real name with link(), which never
  // replaces an existing file: whoever reads the real name sees a complete pair or none (4962a40 审查 P2).
  const temporary = join(directory, `.${VAPID_KEY_FILE}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(keys)}\n`, { encoding: 'utf8', mode: SECRET_FILE_MODE, flag: 'wx' });
    // The mode given to writeFile is filtered by the umask; set it explicitly before the file gets its name.
    await chmod(temporary, SECRET_FILE_MODE);
    await link(temporary, path);
  } catch (error) {
    if (!isTaken(error)) {
      throw new Error(`写不了 ${path}`, { cause: error });
    }
    // Another process published its pair first: theirs is the one browsers will subscribe with.
    const winner = await readKeys(path);
    if (winner === undefined) {
      throw new Error(`${path} 刚被另一个进程建好又不见了`, { cause: error });
    }
    return winner;
  } finally {
    await rm(temporary, { force: true });
  }
  return keys;
}
