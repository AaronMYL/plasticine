// 第 12 批：主线的名字、头像字、颜色（11-12 Aaron 定：主线 AI 的名字可以自己起）。存在 kernel_settings 一个键里；
// 新名字用在栏目、主线、署名、输入框提示、它的自称和发给好友的资料（aiName）；窗口标题、安装包、官网等产品名不变。

import { Value } from 'typebox/value';
import { DEFAULT_MAIN, DEFAULT_MAIN_NAME, MainIdentitySchema, type MainIdentity } from '../../shared/api/mates.ts';
import type { StateService } from '../state/index.ts';

const KEY = 'main_identity';

export type MainIdentityState = Pick<StateService, 'kernelSettings'>;

export function mainIdentity(state: MainIdentityState): MainIdentity {
  const stored = state.kernelSettings.get(KEY);
  return Value.Check(MainIdentitySchema, stored) ? stored : DEFAULT_MAIN;
}

export function setMainIdentity(state: MainIdentityState, input: MainIdentity): MainIdentity {
  const name = input.name.trim();
  const avatar = input.avatar?.trim() ?? '';
  const next: MainIdentity = { name: name.length < 2 ? DEFAULT_MAIN_NAME : name, avatar: avatar === '' ? null : avatar,
    hue: input.hue };
  state.kernelSettings.set(KEY, next);
  return next;
}

/** 发给好友的 AI 名字：没改过（还叫 Plasticine）就是 null，对方那边照写 Plasticine。 */
export function aiNameOf(state: MainIdentityState): string | null {
  const { name } = mainIdentity(state);
  return name === DEFAULT_MAIN_NAME ? null : name;
}
