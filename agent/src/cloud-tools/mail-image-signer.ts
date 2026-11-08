// 邮件图片代理地址的签名（用户 2026-11-04 定：外部图片服务器代为加载）。显示邮件的 iframe 是沙箱，带不了会话 cookie
// （SameSite=Strict），所以代理地址里带服务端签的 HMAC-SHA256：签的是「过期时间 + 原图网址」。密钥只在服务器上
// （<状态目录>/mail-image.key，0600，第一次用时生成），不进日志、不进库、不回给客户端。

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAIL_IMAGE_PATH } from '../../shared/api/mail.ts';

const KEY_FILE = 'mail-image.key';
const KEY_BYTES = 32;
const KEY_MODE = 0o600;
// 签名有效 12 到 24 小时：过期时间取到下一个 12 小时整点再加 12 小时——同一个窗口里同一张图的地址不变，浏览器缓存认得；
// 一封信打开着过了一天，重新打开会拿到新签名。
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
        // 另一个进程刚生成了：用它的。
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

  /** 一张远程图的代理地址（站内相对路径）。 */
  url(target: string): string {
    const now = this.#now().getTime();
    const expires = String(Math.ceil((now + STEP_MS) / STEP_MS) * STEP_MS / 1000);
    return `${MAIL_IMAGE_PATH}?u=${encodeURIComponent(target)}&e=${expires}&s=${this.#sign(target, expires)}`;
  }

  /** 先核签名再看过期：签名对不上的一律 invalid，不说它过没过期。 */
  check(target: string, expires: string, signature: string): SignatureCheck {
    const expected = Buffer.from(this.#sign(target, expires));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      return 'invalid';
    }
    return Number(expires) * 1000 > this.#now().getTime() ? 'ok' : 'expired';
  }
}
