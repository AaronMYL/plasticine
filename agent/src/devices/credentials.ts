import { createHash, randomBytes, randomInt } from 'node:crypto';

const CREDENTIAL_BYTES = 32;
const CREDENTIAL_PREFIX = 'pn1_';
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const NODE_CODE_LENGTH = 8;
const GROUP = 4;
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
