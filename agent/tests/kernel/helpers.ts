// 新内核模型连接的测试装配：不联网的假提供商——一家有订阅登录（OAuth，流程照 pi-ai 的 AuthInteraction 走：
// 先给授权网址，再等交回调地址），一家只能填 key。对话都由 pi-ai 的假模型答。

import { envApiKeyAuth, fauxProvider, type FauxProviderHandle, type OAuthAuth, type Provider }
  from '@earendil-works/pi-ai';

export const FAKE_AUTH_URL = 'https://auth.fake.test/authorize?client_id=fake-client'
  + '&redirect_uri=http%3A%2F%2F127.0.0.1%3A1455%2Fauth%2Fcallback&state=state-value-for-tests-only-0123456789';
export const GOOD_CALLBACK = 'http://127.0.0.1:1455/auth/callback?code=ok-for-tests&state=state-value';

export interface FakeProviders {
  oauth: FauxProviderHandle;
  keyOnly: FauxProviderHandle;
  providers: Provider[];
  /** 登录流程拿到的设备 id（每次登录记一笔）。 */
  deviceIds: string[];
}

function withAuth(handle: FauxProviderHandle, name: string, auth: Provider['auth']): Provider {
  const base = handle.provider;
  return {
    id: base.id,
    name,
    auth,
    getModels: () => base.getModels(),
    stream: (model, context, options) => base.stream(model, context, options),
    streamSimple: (model, context, options) => base.streamSimple(model, context, options),
  };
}

/** 先列这家订阅登录的两种方式再登录的假流程（11-14：pi-ai 的 OpenAI Codex 登录先问用浏览器还是设备码）。 */
export function pickingProvider(): Provider {
  const handle = fauxProvider({ provider: 'fake-pick', models: [{ id: 'pick-model', reasoning: true,
    contextWindow: 100_000 }] });
  const login: OAuthAuth = {
    name: 'Fake 选方式',
    isSubscription: true,
    async login(interaction) {
      const method = await interaction.prompt({ type: 'select', message: '用哪种方式登录',
        options: [{ id: 'browser', label: '浏览器（默认）' }, { id: 'device_code', label: '设备码' }] });
      if (method !== 'browser') {
        throw new Error(`选了不认识的方式：${method}`);
      }
      interaction.notify({ type: 'auth_url', url: FAKE_AUTH_URL, instructions: '在浏览器里点同意' });
      const input = await interaction.prompt({ type: 'manual_code', message: '粘贴浏览器跳转到的地址',
        placeholder: 'http://localhost:1455/auth/callback', signal: interaction.signal });
      if (!input.includes('code=ok')) {
        throw new Error('回调地址里没有授权码');
      }
      return { type: 'oauth', access: 'pick-access-for-tests', refresh: 'pick-refresh-for-tests',
        expires: Date.now() + 3_600_000 };
    },
    async refresh(credential) {
      return credential;
    },
    async toAuth(credential) {
      return { apiKey: credential.access };
    },
  };
  return withAuth(handle, 'Fake 选方式', { oauth: login });
}

export function fakeProviders(): FakeProviders {
  const deviceIds: string[] = [];
  const oauth = fauxProvider({ provider: 'fake-sub', models: [
    { id: 'sub-large', reasoning: true, contextWindow: 200_000 },
    { id: 'sub-small', reasoning: true, contextWindow: 100_000 },
  ] });
  const keyOnly = fauxProvider({ provider: 'fake-key',
    models: [{ id: 'key-model', reasoning: true, contextWindow: 100_000 }] });
  const login: OAuthAuth = {
    name: 'Fake 订阅',
    loginLabel: '用 Fake 订阅登录',
    isSubscription: true,
    async login(interaction, options) {
      deviceIds.push(options?.getDeviceId?.() ?? '');
      interaction.notify({ type: 'auth_url', url: FAKE_AUTH_URL, instructions: '在浏览器里点同意' });
      const input = await interaction.prompt({ type: 'manual_code', message: '粘贴浏览器跳转到的地址',
        placeholder: 'http://127.0.0.1:1455/auth/callback', signal: interaction.signal });
      if (!input.includes('code=ok')) {
        throw new Error('回调地址里没有授权码');
      }
      return { type: 'oauth', access: 'access-value-for-tests', refresh: 'refresh-value-for-tests',
        expires: Date.now() + 3_600_000 };
    },
    async refresh(credential) {
      return credential;
    },
    async toAuth(credential) {
      return { apiKey: credential.access };
    },
  };
  const providers = [
    withAuth(oauth, 'Fake 订阅', { oauth: login, apiKey: envApiKeyAuth('Fake 订阅 key', ['FAKE_SUB_KEY']) }),
    withAuth(keyOnly, 'Fake Key', { apiKey: envApiKeyAuth('Fake key', ['FAKE_KEY']) }),
  ];
  return { oauth, keyOnly, providers, deviceIds };
}
