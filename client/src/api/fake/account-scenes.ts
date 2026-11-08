// 首次使用流程的本地开发 / 截图场景（11-08）：地址带 ?account= 换成设计稿里那几屏。
// - setup：新装、还没有主人（建账号页，第 1 步）；
// - login：已经有主人 @you、这台没登录（登录页）；
// - connect：刚建完账号、一家模型都没连（连接模型，第 2 步）；
// - phone：刚建完账号、连上了模型、起了 @alex（在手机上也能用，第 3 步）；
// - first：刚走完三步，主线里只有 Plasticine 的欢迎（第一次进主线）；
// - setpw 不在这里：它要完整的示例数据，main.tsx 在默认场景上加 seedNoPassword。

import type { FakeApi } from './index.ts';

export type AccountScene = 'setup' | 'login' | 'connect' | 'phone' | 'first' | 'setpw';

const SCENES: readonly AccountScene[] = ['setup', 'login', 'connect', 'phone', 'first', 'setpw'];

export function accountSceneOf(search: string): AccountScene | null {
  const value = new URLSearchParams(search).get('account');
  return SCENES.find((scene) => scene === value) ?? null;
}

/** 这几个场景在 ?account= 之后接着走「第一次的流程」（连模型第 2 步、手机第 3 步）。 */
export function sceneInFirstRun(scene: AccountScene): boolean {
  return scene === 'connect' || scene === 'phone';
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
      return;
    case 'phone':
      account.seedName('Alex');
      network.register('alex', 'Alex');
      session.signInForDevelopment('MacBook Air');
      connectModel(fake);
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
