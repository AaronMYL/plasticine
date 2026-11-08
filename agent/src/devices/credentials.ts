// 节点的长期凭证和一次性配对码。明文只交出一次（凭证在配对回答里，码在领码回答里），库里只有 SHA-256 散列；两样都不进
// 日志、不进错误文案。码用 Crockford base32（没有 I、L、O、U），读出来、抄下来都不容易错。

import { createHash, randomBytes, randomInt } from 'node:crypto';

// 256 random bits, like a session token: guessing a live credential is not a thing to plan for.
const CREDENTIAL_BYTES = 32;
// A prefix says what the string is when it turns up somewhere it should not (a paste, a screenshot).
const CREDENTIAL_PREFIX = 'pn1_';
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
// 32^8 ≈ 10^12 values for 10 minutes and one use, with the shared wrong-code limiter in front (app/config.ts).
export const NODE_CODE_LENGTH = 8;
const GROUP = 4;
// Decision 90 ② for login codes, the same here: 10 minutes, one use.
export const NODE_CODE_TTL_MS = 10 * 60 * 1000;

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function newNodeCredential(): string {
  return `${CREDENTIAL_PREFIX}${randomBytes(CREDENTIAL_BYTES).toString('base64url')}`;
}

export function newNodeCode(): string {
  let code = '';
  for (let index = 0; index < NODE_CODE_LENGTH; index += 1) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return `${code.slice(0, GROUP)}-${code.slice(GROUP)}`;
}

/** Case, spaces and hyphens do not matter; O, I and L are read as the digits they look like. */
export function normalizeNodeCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

export function nodeCodeHash(input: string): string {
  return hashSecret(normalizeNodeCode(input));
}
