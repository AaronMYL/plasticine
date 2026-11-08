// 本体跑在哪（开始页二选一、设置 · 系统「Plasticine 跑在哪」）：这台电脑或远程。这里只有纯逻辑：第一次打开时的预填、
// 远程地址怎么规整、窗口该载入哪个地址。切换不搬数据（他 11-06 定）。

import type { ServerChoice } from '../../../agent/shared/api/desktop-bridge.ts';

/** 和本体的默认端口一致（agent/src/app/config.ts），Linux、Mac、Windows 安装包都用这个。 */
export const LOCAL_SERVER_PORT = 8790;
export const LOCAL_SERVER_URL = `http://127.0.0.1:${LOCAL_SERVER_PORT}/`;

/**
 * 第一次打开时不替他选（11-08 首次使用流程：先二选一，不再悄悄默认这台电脑）。设置里先放一份没选过的：模式只是占位，
 * 旧 Swift 版存的远程地址留作「连到我的 Plasticine」那一格的预填。
 */
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

/** 远程地址只收 https 的源地址（主机名或 IP，可带端口）；不带账号、路径、查询。没写 https:// 的补上。 */
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

/** 窗口载入哪个地址。远程没地址、这台电脑却没带本体：null，窗口回开始页让他重选（不悄悄回落本机）。 */
export function targetUrl(choice: ServerChoice, bundled: boolean): string | null {
  if (choice.mode === 'remote') {
    return choice.remoteUrl;
  }
  return bundled ? LOCAL_SERVER_URL : null;
}

/** 某个网址是不是现在界面所在的本站（ipc 只收本站主 frame 的消息）。 */
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
