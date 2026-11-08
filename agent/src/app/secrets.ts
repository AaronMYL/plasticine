// Session tokens and their hashes. A token is shown once, in the Set-Cookie header; the library keeps the hash only.

import { createHash, randomBytes } from 'node:crypto';

// 256 random bits: guessing a live session is not a thing to plan for.
const TOKEN_BYTES = 32;

export function newSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** SHA-256 in hex. Enough for random tokens; pairing codes are short-lived and single-use on top of it. */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}
