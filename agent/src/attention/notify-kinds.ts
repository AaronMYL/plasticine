// 通知按类型开关（第13批，11-14 Aaron 定）：存在服务器的设置里（kernel_settings 一个键，不加表），所有设备一起生效。
// 关掉的那一类只是不弹系统通知（网页推送、桌面客户端自己弹的都不弹），对话和消息里照常有。没设过、存坏了都当全开。

import { Value } from 'typebox/value';
import { NOTIFY_KINDS_DEFAULT, NotifyKindsSchema, type NotifyKinds } from '../../shared/api/push.ts';
import type { StateService } from '../state/index.ts';

const KEY = 'notify_kinds';

export type NotifyKindsState = Pick<StateService, 'kernelSettings'>;

export function readNotifyKinds(state: NotifyKindsState): NotifyKinds {
  const stored = state.kernelSettings.get(KEY);
  return Value.Check(NotifyKindsSchema, stored) ? stored : { ...NOTIFY_KINDS_DEFAULT };
}

export function writeNotifyKinds(state: NotifyKindsState, kinds: NotifyKinds): NotifyKinds {
  const saved = { ...kinds };
  state.kernelSettings.set(KEY, saved);
  return saved;
}
