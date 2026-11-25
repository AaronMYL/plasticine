import type { ServerChoice } from '../../../agent/shared/api/desktop-bridge.ts';

export const LOCAL_SERVER_PORT = 8790;
export const LOCAL_SERVER_URL = `http://127.0.0.1:${LOCAL_SERVER_PORT}/`;

export function prefillRemote(legacyRemote: string | null): ServerChoice {
  return { mode: 'this_computer', remoteUrl: legacyRemote === null ? null : safeRemote(legacyRemote) };
}

function safeRemote(raw: string): string | null {
  try {
    return normalizeRemoteUrl(raw);
  } catch (error) {
    if (error instanceof RemoteUrlError) {
      return null;
    }
    throw error;
  }
}

export class RemoteUrlError extends Error {}

export function normalizeRemoteUrl(input: string): string {
  const trimmed = input.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new RemoteUrlError('远程地址应为 https://主机名或IP[:端口]，请检查后再选。', { cause: error });
    }
    throw error;
  }
  const extra = url.username !== '' || url.password !== '' || (url.pathname !== '/' && url.pathname !== '')
    || url.search !== '' || url.hash !== '';
  if (url.protocol !== 'https:' || url.hostname === '' || extra) {
    throw new RemoteUrlError('远程地址应为 https://主机名或IP[:端口]，请检查后再选。');
  }
  return `${url.origin}/`;
}

export function targetUrl(choice: ServerChoice, bundled: boolean): string | null {
  if (choice.mode === 'remote') {
    return choice.remoteUrl;
  }
  return bundled ? LOCAL_SERVER_URL : null;
}

export function sameOrigin(url: string, target: string): boolean {
  try {
    return new URL(url).origin === new URL(target).origin;
  } catch (error) {
    if (error instanceof TypeError) {
      return false;
    }
    throw error;
  }
}
