// 本体跑在哪（设置 · 系统「Plasticine 跑在哪」，设计稿 Settings-System）：这台电脑或远程。这里只有纯逻辑：第一次装时
// 默认哪个、远程地址怎么规整、窗口该载入哪个地址。切换不搬数据（他 11-06 定）。

import type { ServerChoice } from '../../../agent/shared/api/desktop-bridge.ts';

/** 和本体的默认端口一致（agent/src/app/config.ts），Linux、Mac、Windows 安装包都用这个。 */
export const LOCAL_SERVER_PORT = 8790;
export const LOCAL_SERVER_URL = `http://127.0.0.1:${LOCAL_SERVER_PORT}/`;

/**
 * 第一次打开时默认哪个：包里没带本体只能远程；以前装过 Plasticine（有 Swift 版的设置或数据目录）照旧用远程，
 * 不改老用户的习惯（和 mac/Sources/Plasticine/server-mode.swift 同一条）；新装的默认这台电脑。
 */
export function initialChoice(input: { bundled: boolean; priorInstall: boolean; legacyRemote: string | null;
  legacyMode: 'this_computer' | 'remote' | null }): ServerChoice {
  const remoteUrl = input.legacyRemote === null ? null : safeRemote(input.legacyRemote);
  if (!input.bundled) {
    return { mode: 'remote', remoteUrl };
  }
  if (input.legacyMode !== null) {
    return { mode: input.legacyMode, remoteUrl };
  }
  return { mode: input.priorInstall ? 'remote' : 'this_computer', remoteUrl };
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

/** 窗口载入哪个地址。选了远程却没填过地址：先回这台电脑（带了本体时），否则是 null，界面打开设置让他填。 */
export function targetUrl(choice: ServerChoice, bundled: boolean): string | null {
  if (choice.mode === 'remote') {
    return choice.remoteUrl ?? (bundled ? LOCAL_SERVER_URL : null);
  }
  return bundled ? LOCAL_SERVER_URL : choice.remoteUrl;
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
