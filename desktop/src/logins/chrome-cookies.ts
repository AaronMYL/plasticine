import { createDecipheriv, pbkdf2Sync } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const WINDOWS_EPOCH_MICROS = 11_644_473_600_000_000n;
export const HASHED_DOMAIN_VERSION = 24;

export type ChromeKey = { scheme: 'cbc'; key: Buffer } | { scheme: 'gcm'; key: Buffer };

export interface ChromeCookie {
  host: string;
  name: string;
  value: string;
  path: string;
  expires: number | null;
  secure: boolean;
  httpOnly: boolean;
  sameSite: number;
}

export class ChromeImportProblem extends Error {}

export function cbcKey(secret: string, rounds: number): ChromeKey {
  return { scheme: 'cbc', key: pbkdf2Sync(secret, 'saltysalt', rounds, 16, 'sha1') };
}

export function decryptValue(encrypted: Buffer, key: ChromeKey, dropDomainHash: boolean): string | null {
  const prefix = encrypted.subarray(0, 3).toString('latin1');
  let plain: Buffer;
  try {
    if (key.scheme === 'cbc' && prefix === 'v10') {
      const decipher = createDecipheriv('aes-128-cbc', key.key, Buffer.alloc(16, 0x20));
      plain = Buffer.concat([decipher.update(encrypted.subarray(3)), decipher.final()]);
    } else if (key.scheme === 'gcm' && (prefix === 'v10' || prefix === 'v11')) {
      const nonce = encrypted.subarray(3, 15);
      const tag = encrypted.subarray(encrypted.length - 16);
      const decipher = createDecipheriv('aes-256-gcm', key.key, nonce);
      decipher.setAuthTag(tag);
      plain = Buffer.concat([decipher.update(encrypted.subarray(15, encrypted.length - 16)), decipher.final()]);
    } else {
      return null;
    }
  } catch (error) {
    if (error instanceof Error && /bad decrypt|unable to authenticate|wrong final block/i.test(error.message)) {
      return null;
    }
    throw error;
  }
  if (dropDomainHash) {
    if (plain.length < 32) {
      return null;
    }
    plain = plain.subarray(32);
  }
  const text = plain.toString('utf8');
  return Buffer.from(text, 'utf8').equals(plain) ? text : null;
}

export function withCopy<T>(database: string, read: (db: DatabaseSync) => T): T {
  if (!existsSync(database)) {
    throw new ChromeImportProblem('这台电脑上没找到 Chrome 的 Cookie 库：Chrome 装过、登录过吗？');
  }
  const directory = mkdtempSync(join(tmpdir(), 'plasticine-chrome-'));
  try {
    const copy = join(directory, 'Cookies');
    try {
      copyFileSync(database, copy);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
        throw new ChromeImportProblem('Chrome 开着、把 Cookie 库锁住了：先退出 Chrome 再导入。', { cause: error });
      }
      throw error;
    }
    const db = new DatabaseSync(copy, { readOnly: true });
    try {
      return read(db);
    } finally {
      db.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function cookieHosts(database: string): string[] {
  return withCopy(database, (db) => db.prepare('SELECT DISTINCT host_key FROM cookies').all()
    .map((row) => String(row.host_key)));
}

export function readCookies(database: string, key: ChromeKey, now: Date): { cookies: ChromeCookie[];
  skipped: number } {
  return withCopy(database, (db) => {
    const meta = db.prepare("SELECT value FROM meta WHERE key = 'version'").get();
    const dropHash = Number(meta?.value ?? 0) >= HASHED_DOMAIN_VERSION;
    const statement = db.prepare('SELECT host_key, name, value, encrypted_value, path, expires_utc, is_secure, '
      + 'is_httponly, samesite FROM cookies');
    statement.setReadBigInts(true);
    const rows = statement.all();
    const cookies: ChromeCookie[] = [];
    let skipped = 0;
    for (const row of rows) {
      const plain = String(row.value ?? '');
      const encrypted = row.encrypted_value instanceof Uint8Array ? Buffer.from(row.encrypted_value) : Buffer.alloc(0);
      const value = plain !== '' ? plain : decryptValue(encrypted, key, dropHash);
      const micros = BigInt(row.expires_utc as number | bigint);
      const expires = micros === 0n ? null : Number((micros - WINDOWS_EPOCH_MICROS) / 1_000_000n);
      if (value === null || (expires !== null && expires * 1000 <= now.getTime())) {
        skipped += 1;
        continue;
      }
      cookies.push({ host: String(row.host_key), name: String(row.name), value, path: String(row.path || '/'),
        expires, secure: Number(row.is_secure) !== 0, httpOnly: Number(row.is_httponly) !== 0,
        sameSite: Number(row.samesite) });
    }
    return { cookies, skipped };
  });
}

export function windowsEncryptedKey(localState: string): Buffer {
  let parsed: unknown;
  try {
    parsed = JSON.parse(localState);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ChromeImportProblem('Chrome 的 Local State 读不懂，没有导入。', { cause: error });
    }
    throw error;
  }
  const encoded = (parsed as { os_crypt?: { encrypted_key?: unknown } }).os_crypt?.encrypted_key;
  if (typeof encoded !== 'string') {
    throw new ChromeImportProblem('Chrome 的 Local State 里没有钥匙，没有导入。');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.subarray(0, 5).toString('latin1') !== 'DPAPI') {
    throw new ChromeImportProblem('Chrome 的钥匙格式和预想的不一样，没有导入。');
  }
  return bytes.subarray(5);
}

export function siteOf(host: string): string {
  const labels = host.replace(/^\./, '').toLowerCase().split('.').filter(Boolean);
  if (labels.length <= 2 || /^\d+$/.test(labels[labels.length - 1] ?? '')) {
    return labels.join('.');
  }
  const tail = labels.slice(-2).join('.');
  const second = /^(?:com|net|org|gov|edu|ac|co)\.[a-z]{2}$/.test(tail);
  return labels.slice(second ? -3 : -2).join('.');
}
