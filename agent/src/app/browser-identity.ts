import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import type { StateService } from '../state/index.ts';

export const BROWSER_IDENTITIES_KEY = 'internal_browser_identities';
const IdentitySchema = Type.Object({
  source: Type.String(), deviceId: Type.String(), nodeId: Type.Union([Type.String(), Type.Null()]),
  credentialHash: Type.Union([Type.String(), Type.Null()]),
});
const IdentitiesSchema = Type.Array(IdentitySchema);
export type BrowserIdentity = Static<typeof IdentitySchema>;

export function browserIdentities(state: StateService): BrowserIdentity[] {
  const stored = state.kernelSettings.get(BROWSER_IDENTITIES_KEY);
  return Value.Check(IdentitiesSchema, stored) ? stored : [];
}

export function browserIdentity(state: StateService, deviceId: string): BrowserIdentity | undefined {
  return browserIdentities(state).find((identity) => identity.deviceId === deviceId);
}

export function browserIdentityLive(state: StateService, identity: BrowserIdentity): boolean {
  if (identity.nodeId === null) return true;
  const node = state.nodes.get(identity.nodeId);
  return node !== undefined && node.revokedAt === null && node.credentialHash === identity.credentialHash;
}
