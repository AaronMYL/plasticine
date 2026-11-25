import { tunnelHost } from '../../shared/tunnel-wire.ts';
import { DEFAULT_RELAY_URL, effectiveRelayUrl } from '../network/index.ts';
import type { StateService } from '../state/index.ts';
import { DEFAULT_PORT } from './config.ts';
import { storedOwnUrl } from './own-url.ts';

type Env = Record<string, string | undefined>;
const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];

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

export function handlePublicUrl(handle: string, relayUrl: string | undefined, env: Env): string {
  const relay = new URL(effectiveRelayUrl(relayUrl, env['PLASTICINE_NETWORK_URL'] ?? DEFAULT_RELAY_URL));
  const domain = LOOPBACK_HOSTS.includes(relay.hostname) ? new URL(DEFAULT_RELAY_URL).hostname : relay.hostname;
  return `https://${tunnelHost(handle, domain)}`;
}

export function localPublicUrl(env: Env): string {
  return `http://127.0.0.1:${Number(env['PLASTICINE_PORT'] ?? DEFAULT_PORT)}`;
}

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
