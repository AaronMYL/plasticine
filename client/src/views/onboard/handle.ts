import { Value } from 'typebox/value';
import { HandleSchema } from '../../api/shared.ts';

export const HANDLE_DOMAIN = 'cyberhunter.top';

export function handleHost(handle: string): string {
  return `${handle.replace(/_/g, '-')}.${HANDLE_DOMAIN}`;
}

export function normalizeHandle(input: string): string {
  return input.trim().replace(/^@/, '').replace(/\s+/g, '').toLowerCase();
}

export function validHandle(handle: string): boolean {
  return Value.Check(HandleSchema, handle);
}

export type LoginTarget = { kind: 'here' } | { kind: 'elsewhere'; url: string } | { kind: 'bad' };

export function loginTarget(input: string, hereHandle: string | null | undefined, here: URL | null): LoginTarget {
  const value = input.trim();
  if (value === '') {
    return here === null ? { kind: 'bad' } : { kind: 'here' };
  }
  const handle = normalizeHandle(value);
  if (!/[.:/]/.test(value)) {
    if (!validHandle(handle)) return { kind: 'bad' };
    if (here !== null && (hereHandle === undefined || hereHandle === handle)) return { kind: 'here' };
    return { kind: 'elsewhere', url: `https://${handleHost(handle)}/#/login` };
  }
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
  } catch (cause) {
    if (cause instanceof TypeError) return { kind: 'bad' };
    throw cause;
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username !== '' || url.password !== '') {
    return { kind: 'bad' };
  }
  if (here !== null && url.host === here.host) {
    return { kind: 'here' };
  }
  return { kind: 'elsewhere', url: `${url.origin}/#/login` };
}
