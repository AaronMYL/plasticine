// 加入网络的核心一步（服务里的「加入」和装服务器时 setup-link --handle 共用）：本机生成两对钥匙，到中继注册（用新钥匙
// 签），记下账号。同一个 handle 再来拿回原来那个；已经用别的 handle 加入了就报错。

import type { NetworkIdentity } from '../../shared/state.ts';
import { generateIdentityKeys } from '../../protocol/crypto.ts';
import type { StateService } from '../state/index.ts';
import { NetworkError } from './errors.ts';
import { RelayCallError, type RelayClient } from '../../protocol/relay-client.ts';

export function relayFailure(error: unknown): never {
  if (error instanceof RelayCallError) {
    throw error.kind === 'refused' ? new NetworkError('relay_refused', error.message)
      : new NetworkError('relay_unreachable', '连不上 Cyber Hunter 中继，这次没做成。核对中继地址，稍后再试。');
  }
  throw error;
}

export interface RegisterInput {
  handle: string;
  displayName: string;
  inviteCode: string | null;
  relayUrl: string;
}

export interface Registered {
  identity: NetworkIdentity;
  /** 用了谁的邀请码；早就加入过的是 null。 */
  invitedBy: string | null;
  /** 这一次才注册的（false = 早就以这个 handle 加入了）。 */
  fresh: boolean;
}

export async function registerIdentity(state: StateService, client: RelayClient, input: RegisterInput, now: Date)
  : Promise<Registered> {
  const existing = state.networkIdentity.get();
  if (existing !== undefined) {
    if (existing.handle === input.handle) {
      return { identity: existing, invitedBy: null, fresh: false };
    }
    throw new NetworkError('already_joined', `这台 Plasticine 已经以 @${existing.handle} 加入网络了。`);
  }
  const keys = generateIdentityKeys();
  const { account, invitedBy } = await client.registerFor({ handle: input.handle, displayName: input.displayName,
    signingKey: keys.signing.publicKey, encryptionKey: keys.encryption.publicKey,
    ...(input.inviteCode === null || input.inviteCode.trim() === '' ? {} : { inviteCode: input.inviteCode }) },
  keys.signing.privateKey).catch(relayFailure);
  const identity = state.networkIdentity.create({ accountId: account.id, handle: account.handle,
    displayName: account.displayName, relayUrl: input.relayUrl, signingPublicKey: keys.signing.publicKey,
    signingPrivateKey: keys.signing.privateKey, encryptionPublicKey: keys.encryption.publicKey,
    encryptionPrivateKey: keys.encryption.privateKey, joinedAt: now.toISOString() });
  return { identity, invitedBy, fresh: true };
}
