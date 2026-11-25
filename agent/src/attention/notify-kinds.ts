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
