// Plasticine 写给他的网页地址（第 7 批第 14 条，他定）：内核提示词里的「网页 …」、publicPage() 拼的链接、安装包下载地址
// 都从这里取。先看环境变量 PLASTICINE_PUBLIC_URL；没配就用主人 @账号的网址 https://<handle>.cyberhunter.top（入了
// 网才有，handle 的下划线换连字符）；都没有就是本机地址。按需取（函数）：入网、改 handle 之后不用重启。

import { tunnelHost } from '../../shared/tunnel-wire.ts';
import { DEFAULT_RELAY_URL, effectiveRelayUrl } from '../network/index.ts';
import type { StateService } from '../state/index.ts';
import { DEFAULT_PORT } from './config.ts';
import { storedOwnUrl } from './own-url.ts';

type Env = Record<string, string | undefined>;
const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];

/** 环境变量里配的地址（校验过、去掉末尾斜杠）；没配是 null。 */
export function configuredPublicUrl(env: Env): string | null {
  const raw = env['PLASTICINE_PUBLIC_URL'];
  if (raw === undefined || raw.trim() === '') {
    return null;
  }
  const url = new URL(raw.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username !== '' || url.password !== ''
    || url.search !== '' || url.hash !== '') {
    throw new Error('PLASTICINE_PUBLIC_URL 要填不带登录信息、查询参数或 hash 的网页地址。');
  }
  return url.href.replace(/\/$/, '');
}

/** @账号的网址：中继主域名取身份里记的（本机中继的回落到默认主域名）。 */
export function handlePublicUrl(handle: string, relayUrl: string | undefined, env: Env): string {
  const relay = new URL(effectiveRelayUrl(relayUrl, env['PLASTICINE_NETWORK_URL'] ?? DEFAULT_RELAY_URL));
  const domain = LOOPBACK_HOSTS.includes(relay.hostname) ? new URL(DEFAULT_RELAY_URL).hostname : relay.hostname;
  return `https://${tunnelHost(handle, domain)}`;
}

/** 本机地址（桌面客户端、刚装好还没入网的服务器）。 */
export function localPublicUrl(env: Env): string {
  return `http://127.0.0.1:${Number(env['PLASTICINE_PORT'] ?? DEFAULT_PORT)}`;
}

/**
 * 环境变量 > 他在设置里存的自己的网址（own-url.ts）> @账号的网址 > 本机地址；每次调用现取。
 * 环境变量写错在装配时就报出来。
 */
export function publicUrlSource(state: Pick<StateService, 'networkIdentity' | 'kernelSettings'>,
  env: Env = process.env): () => string {
  const configured = configuredPublicUrl(env);
  return () => {
    if (configured !== null) {
      return configured;
    }
    const own = storedOwnUrl(state);
    if (own !== null) {
      return own;
    }
    const identity = state.networkIdentity.get();
    return identity === undefined ? localPublicUrl(env) : handlePublicUrl(identity.handle, identity.relayUrl, env);
  };
}
