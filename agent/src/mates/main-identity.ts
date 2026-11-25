import { Value } from 'typebox/value';
import { DEFAULT_MAIN, DEFAULT_MAIN_NAME, MainIdentitySchema, type MainIdentity } from '../../shared/api/mates.ts';
import { DEFAULT_MATE_VARIANT } from '../../shared/api/mate-characters.ts';
import type { StateService } from '../state/index.ts';

const KEY = 'main_identity';

export type MainIdentityState = Pick<StateService, 'kernelSettings'>;

export function mainIdentity(state: MainIdentityState): MainIdentity {
  const stored = state.kernelSettings.get(KEY);
  const found = Value.Check(MainIdentitySchema, stored) ? stored : DEFAULT_MAIN;
  return { name: found.name, variant: found.variant ?? DEFAULT_MATE_VARIANT };
}

export function setMainIdentity(state: MainIdentityState, input: MainIdentity): MainIdentity {
  const name = input.name.trim();
  const next: MainIdentity = { name: name.length < 2 ? DEFAULT_MAIN_NAME : name,
    variant: input.variant ?? mainIdentity(state).variant ?? DEFAULT_MATE_VARIANT };
  state.kernelSettings.set(KEY, next);
  return next;
}

export function aiNameOf(state: MainIdentityState): string | null {
  const { name } = mainIdentity(state);
  return name === DEFAULT_MAIN_NAME ? null : name;
}
