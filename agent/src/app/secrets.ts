import { createHash, randomBytes } from 'node:crypto';

const TOKEN_BYTES = 32;

export function newSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** SHA-256 in hex. Enough for random tokens; pairing codes are short-lived and single-use on top of it. */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}
