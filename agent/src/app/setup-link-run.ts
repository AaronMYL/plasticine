import { NETWORK_HANDLE_PATTERN } from '../../shared/api/network.ts';
import type { RelayClient } from '../../protocol/relay-client.ts';
import { registerIdentity } from '../network/index.ts';
import type { StateService } from '../state/index.ts';
import { normalizeOwnUrl, OWN_URL_KEY, storedOwnUrl } from './own-url.ts';
import { configuredPublicUrl, handlePublicUrl } from './public-url.ts';
import { setupNeeded } from './owner.ts';
import { issueSetupToken } from './setup-link.ts';

type Env = Record<string, string | undefined>;

export interface SetupLinkInput {
  state: StateService;
  env: Env;
  now: Date;
  port: number;
  handle?: string;
  domain?: string;
  relayUrl: string;
  client: (relayUrl: string) => Pick<RelayClient, 'registerFor'>;
}

export interface SetupLinkResult {
  lines: string[];
  joined: boolean;
}

const HANDLE = new RegExp(NETWORK_HANDLE_PATTERN);

function setupPath(token: string): string {
  return `/#/setup?t=${encodeURIComponent(token)}`;
}

function networkBase(state: StateService, env: Env): string | null {
  const configured = configuredPublicUrl(env);
  if (configured !== null) {
    return new URL(configured).origin;
  }
  const own = storedOwnUrl(state);
  if (own !== null) {
    return own;
  }
  const identity = state.networkIdentity.get();
  return identity === undefined ? null : handlePublicUrl(identity.handle, identity.relayUrl, env);
}

export async function setupLink(input: SetupLinkInput): Promise<SetupLinkResult> {
  const { state, env, now } = input;
  if (!setupNeeded(state)) {
    return { lines: ['这份 Plasticine 已经有主人了：用 @账号和密码登录。忘了密码运行 plasticine password。'],
      joined: false };
  }
  let joined = false;
  if (input.handle !== undefined) {
    const handle = input.handle.trim().replace(/^@/, '').toLowerCase();
    if (!HANDLE.test(handle)) {
      throw new Error('@账号要 3–24 位小写字母、数字或下划线。');
    }
    const registered = await registerIdentity(state, input.client(input.relayUrl) as RelayClient,
      { handle, displayName: handle, inviteCode: null, relayUrl: input.relayUrl }, now);
    joined = registered.fresh;
  }
  if (input.domain !== undefined) {
    const raw = input.domain.trim();
    state.kernelSettings.set(OWN_URL_KEY, normalizeOwnUrl(raw.startsWith('https://') ? raw : `https://${raw}`));
  }
  const issued = issueSetupToken(state, now);
  if (issued === null) {
    return { lines: ['这份 Plasticine 已经有主人了：用 @账号和密码登录。忘了密码运行 plasticine password。'], joined };
  }
  const lines = ['在浏览器里打开这个链接建账号（30 分钟内有效，只能用一次）：'];
  const base = networkBase(state, env);
  if (base !== null) {
    lines.push(`  ${base}${setupPath(issued.token)}`);
  }
  lines.push(`  http://127.0.0.1:${input.port}${setupPath(issued.token)}`);
  if (joined) {
    lines.push('  @账号的网址要等服务重启、证书签好（一两分钟）才打得开；打不开先用上面本机那行。');
  }
  return { lines, joined };
}
