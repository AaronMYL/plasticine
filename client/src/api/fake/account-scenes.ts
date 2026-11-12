// 首次使用流程的本地开发 / 截图场景（11-08，11-12《首次使用解耦》改）：地址带 ?account= 换成设计稿里那几屏。
// - setup：新装、还没有主人（主线样子的一列，建账号卡）；
// - login：已经有主人 @you、这台没登录（登录页）；
// - connect：刚建完账号、一家模型都没连（主线欢迎卡里的「连上一个模型」）；
// - first：建完账号、连上了模型，主线里只有欢迎卡（收成两行 + 几个开始）；
// - setpw 不在这里：它要完整的示例数据，main.tsx 在默认场景上加 seedNoPassword。

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

/** 在一份没有示例数据的假接口上摆好这个场景（setpw 除外）。 */
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
