// 浏览器登录邀请只放在 fragment；不会进入 HTTP 请求、访问日志或 Referer。
import type { NetworkStatus } from '../../api/shared.ts';

export interface PairingInvitation {
  code: string;
  expiresAt: string;
}

const CODE = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;
const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);
const PREFIX = '#/pair?';

export function readPairingInvitation(hash = window.location.hash): PairingInvitation | null {
  if (!hash.startsWith(PREFIX)) return null;
  const params = new URLSearchParams(hash.slice(PREFIX.length));
  const code = params.get('code') ?? '';
  const expiresAt = params.get('expires') ?? '';
  if (!CODE.test(code) || !Number.isFinite(Date.parse(expiresAt))) return null;
  return { code, expiresAt };
}

/** 消费或取消后从历史项移走；码只在当前表单内存里，不写进标签存档。 */
export function clearPairingLink(): void {
  if (window.location.hash.startsWith(PREFIX)) {
    const base = `${window.location.pathname}${window.location.search}`;
    window.history.replaceState(window.history.state, '', `${base}#/today`);
  }
}

export function pairingLink(base: string, invitation: PairingInvitation): string {
  const url = new URL('/', base);
  url.hash = `/pair?${new URLSearchParams({ code: invitation.code, expires: invitation.expiresAt })}`;
  return url.href;
}

/** 本机安装的 127.0.0.1 指向当前电脑，手机不能用；只用服务返回的真实公开名字，不拼账号猜域名。 */
export function pairingAddress(origin: string, network: NetworkStatus | null)
  : { url: string | null; problem: string | null } {
  const current = new URL(origin);
  if (current.protocol === 'https:' && !LOCAL.has(current.hostname)) {
    return { url: current.origin, problem: null };
  }
  const host = network?.account?.host;
  const tunnel = network?.tunnel;
  if (tunnel?.state === 'connecting' || tunnel?.state === 'error') {
    return { url: null, problem: tunnel.state === 'connecting'
      ? '手机连接地址正在准备，请稍后重新读取。'
      : '手机连接地址暂时不可用，请到账号与网络检查连接后重试。' };
  }
  if (host !== undefined && host !== '') {
    try {
      const url = new URL(`https://${host}`);
      if (url.host === host && url.pathname === '/' && url.username === '' && url.password === ''
        && !LOCAL.has(url.hostname)) return { url: url.origin, problem: null };
    } catch (cause) {
      if (!(cause instanceof TypeError)) throw cause;
    }
  }
  return { url: null, problem: '还没有手机可打开的地址。在「账号与网络」加入网络后，重新读取。' };
}
