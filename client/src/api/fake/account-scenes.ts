import type { FakeApi } from './index.ts';

export type AccountScene = 'setup' | 'login' | 'connect' | 'first' | 'setpw';

const SCENES: readonly AccountScene[] = ['setup', 'login', 'connect', 'first', 'setpw'];

export function accountSceneOf(search: string): AccountScene | null {
  const value = new URLSearchParams(search).get('account');
  return SCENES.find((scene) => scene === value) ?? null;
}

function connectModel(fake: FakeApi): void {
  fake.control.modelProviders.seedConnected([['openai', 'oauth']],
    { provider: 'openai', model: 'gpt-5.5', thinking: 'high' });
}

export function seedAccountScene(fake: FakeApi, scene: Exclude<AccountScene, 'setpw'>): void {
  const { account, network, session } = fake.control;
  switch (scene) {
    case 'setup':
      account.seedFresh();
      return;
    case 'login':
      network.register('you', 'Alex');
      return;
    case 'connect':
      account.seedName('Alex');
      network.register('alex', 'Alex');
      session.signInForDevelopment('MacBook Air');
      account.postWelcome();
      return;
    case 'first':
      account.seedName('Alex');
      network.register('alex', 'Alex');
      session.signInForDevelopment('MacBook Air');
      connectModel(fake);
      account.postWelcome();
      return;
  }
}
