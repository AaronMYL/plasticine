// 一次性建账号链接（2026-11-08：Linux 服务器装完打印 http://127.0.0.1:<端口>/#/setup?t=<令牌>）。令牌只存 SHA-256，
// 30 分钟、用一次；再发一个，旧的作废。已经有主人就不发。

import { randomInt } from 'node:crypto';
import { SETUP_TOKEN_TTL_MS } from '../../shared/api/account.ts';
import type { StateService } from '../state/index.ts';
import { setupNeeded } from './owner.ts';
import { hashSecret } from './secrets.ts';

// Crockford base32（不含 I L O U）：从终端抄也不容易抄错。12 位 = 60 位随机，30 分钟、输错限流，猜不中。
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const LENGTH = 12;
const GROUP = 4;

export function setupTokenHash(token: string): string {
  return hashSecret(token.trim().toUpperCase());
}

export function issueSetupToken(state: StateService, now: Date): { token: string; expiresAt: string } | null {
  if (!setupNeeded(state)) {
    return null;
  }
  let raw = '';
  for (let index = 0; index < LENGTH; index += 1) {
    raw += ALPHABET[randomInt(ALPHABET.length)];
  }
  const token = raw.match(new RegExp(`.{${GROUP}}`, 'g'))?.join('-') ?? raw;
  const expiresAt = new Date(now.getTime() + SETUP_TOKEN_TTL_MS).toISOString();
  state.ownerAccount.issueSetupToken(setupTokenHash(token), expiresAt);
  return { token, expiresAt };
}
