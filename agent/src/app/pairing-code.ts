// One-time pairing codes (decision 90 ②): made on the server by pairing-cli.ts, typed on the device once. Only the
// hash is stored; a code lasts PAIRING_CODE_TTL_MS and one use.

import { randomInt } from 'node:crypto';
import type { StateService } from '../state/index.ts';
import { PAIRING_CODE_TTL_MS } from './config.ts';
import { hashSecret } from './secrets.ts';

// Crockford base32: no I, L, O or U, so a code read aloud or off a terminal is hard to mistype.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const PAIRING_CODE_LENGTH = 8;
const GROUP = 4;

export function generatePairingCode(): string {
  let code = '';
  for (let index = 0; index < PAIRING_CODE_LENGTH; index += 1) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return `${code.slice(0, GROUP)}-${code.slice(GROUP)}`;
}

/** Case, spaces and hyphens do not matter; the letters Crockford leaves out are read as the digits they look like. */
export function normalizePairingCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

export function pairingCodeHash(input: string): string {
  return hashSecret(normalizePairingCode(input));
}

export interface IssuedCode {
  id: string;
  code: string;
  issuedAt: string;
  expiresAt: string;
}

export function issuePairingCode(
  state: Pick<StateService, 'pairingCodes'>,
  now: Date,
  ttlMs: number = PAIRING_CODE_TTL_MS,
): IssuedCode {
  const code = generatePairingCode();
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
  const stored = state.pairingCodes.issue({ codeHash: pairingCodeHash(code), expiresAt });
  return { id: stored.id, code, issuedAt: now.toISOString(), expiresAt };
}
