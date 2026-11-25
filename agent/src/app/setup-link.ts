import { randomInt } from 'node:crypto';
import { SETUP_TOKEN_TTL_MS } from '../../shared/api/account.ts';
import type { StateService } from '../state/index.ts';
import { setupNeeded } from './owner.ts';
import { hashSecret } from './secrets.ts';

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
