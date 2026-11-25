import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAIL_IMAGE_PATH } from '../../shared/api/mail.ts';

const KEY_FILE = 'mail-image.key';
const KEY_BYTES = 32;
const KEY_MODE = 0o600;
const STEP_MS = 12 * 60 * 60 * 1000;

export type SignatureCheck = 'ok' | 'expired' | 'invalid';

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function isTaken(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}

export class MailImageSigner {
  readonly #path: string;
  readonly #now: () => Date;
  #secret: Buffer | null = null;

  constructor(stateDirectory: string, now: () => Date) {
    this.#path = join(stateDirectory, KEY_FILE);
    this.#now = now;
  }

  #key(): Buffer {
    if (this.#secret !== null) {
      return this.#secret;
    }
    try {
      this.#secret = readFileSync(this.#path);
    } catch (error) {
      if (!isMissing(error)) {
        throw error;
      }
      const fresh = randomBytes(KEY_BYTES);
      try {
        writeFileSync(this.#path, fresh, { mode: KEY_MODE, flag: 'wx', flush: true });
        this.#secret = fresh;
      } catch (writeError) {
        if (!isTaken(writeError)) {
          throw writeError;
        }
        this.#secret = readFileSync(this.#path);
      }
    }
    if (this.#secret.length < KEY_BYTES) {
      throw new Error('邮件图片签名的密钥文件不完整，没有签');
    }
    return this.#secret;
  }

  #sign(url: string, expires: string): string {
    return createHmac('sha256', this.#key()).update(`${expires}\n${url}`).digest('base64url');
  }

  url(target: string): string {
    const now = this.#now().getTime();
    const expires = String(Math.ceil((now + STEP_MS) / STEP_MS) * STEP_MS / 1000);
    return `${MAIL_IMAGE_PATH}?u=${encodeURIComponent(target)}&e=${expires}&s=${this.#sign(target, expires)}`;
  }

  check(target: string, expires: string, signature: string): SignatureCheck {
    const expected = Buffer.from(this.#sign(target, expires));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      return 'invalid';
    }
    return Number(expires) * 1000 > this.#now().getTime() ? 'ok' : 'expired';
  }
}
