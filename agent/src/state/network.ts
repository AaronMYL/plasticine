// 联系人与网络的存取（第 113 条，迁移 0045）：这台实例的网络账号（一行）和网络上的人。
// 私钥在 network_identity 里：只有 network/ 拿它签名、解密，接口视图从不带它（app/network.ts 只挑公开字段）。

import {
  ContactInputSchema,
  ContactPatchSchema,
  ContactSchema,
  NETWORK_IDENTITY_ID,
  NetworkIdentityInputSchema,
  NetworkIdentityPatchSchema,
  NetworkIdentitySchema,
  type Contact,
  type ContactInput,
  type ContactPatch,
  type NetworkIdentity,
  type NetworkIdentityInput,
  type NetworkIdentityPatch,
} from '../../shared/state.ts';
import { RECORD_META_COLUMNS, type ColumnMap } from './codec.ts';
import { allPages, ObjectStore, type StoreContext, type StoreSpec } from './object-store.ts';

const IDENTITY_COLUMNS: ColumnMap = {
  ...RECORD_META_COLUMNS,
  accountId: 'text',
  handle: 'text',
  displayName: 'text',
  relayUrl: 'text',
  signingPublicKey: 'text',
  signingPrivateKey: 'text',
  encryptionPublicKey: 'text',
  encryptionPrivateKey: 'text',
  joinedAt: 'text',
  cursor: 'text',
  lastSyncAt: 'text',
  lastError: 'text',
  avatar: 'text',
};

const IDENTITY_SPEC: StoreSpec<typeof NetworkIdentitySchema, typeof NetworkIdentityInputSchema,
  typeof NetworkIdentityPatchSchema> = {
  table: 'network_identity',
  schema: NetworkIdentitySchema,
  input: NetworkIdentityInputSchema,
  patch: NetworkIdentityPatchSchema,
  columns: IDENTITY_COLUMNS,
  defaults: { cursor: '0', lastSyncAt: null, lastError: null, avatar: null },
};

const CONTACT_COLUMNS: ColumnMap = {
  ...RECORD_META_COLUMNS,
  accountId: 'text',
  handle: 'text',
  displayName: 'text',
  signingKey: 'text',
  encryptionKey: 'text',
  relation: 'text',
  state: 'text',
  tierCap: 'text',
  safetyChanged: 'boolean',
  pendingSigningKey: 'text',
  pendingEncryptionKey: 'text',
  ignoredAt: 'text',
  lastAt: 'text',
  avatar: 'text',
  alias: 'text',
  personDocId: 'text',
  linkDismissedAt: 'text',
  removedAt: 'text',
  aiName: 'text',
};

const CONTACT_SPEC: StoreSpec<typeof ContactSchema, typeof ContactInputSchema, typeof ContactPatchSchema> = {
  table: 'contacts',
  schema: ContactSchema,
  input: ContactInputSchema,
  patch: ContactPatchSchema,
  columns: CONTACT_COLUMNS,
  defaults: { relation: 'stranger', tierCap: null, safetyChanged: false, pendingSigningKey: null,
    pendingEncryptionKey: null, ignoredAt: null, avatar: null, alias: null, personDocId: null, linkDismissedAt: null,
    removedAt: null, aiName: null },
};

export function createNetworkStores(context: StoreContext) {
  const identity = new ObjectStore(context, IDENTITY_SPEC);
  const contacts = new ObjectStore(context, CONTACT_SPEC);
  return {
    networkIdentity: {
      get: (): NetworkIdentity | undefined => identity.get(NETWORK_IDENTITY_ID),
      /** 加入网络：只有一行；已经有了是冲突（换账号不在这一版里）。 */
      create: (input: NetworkIdentityInput): NetworkIdentity => identity.create(input, undefined,
        { id: NETWORK_IDENTITY_ID }),
      update: (version: number, patch: NetworkIdentityPatch): NetworkIdentity =>
        identity.update(NETWORK_IDENTITY_ID, version, patch),
    },
    contacts: {
      get: contacts.get.bind(contacts),
      require: contacts.require.bind(contacts),
      create: (input: ContactInput): Contact => contacts.create(input),
      update: (id: string, version: number, patch: ContactPatch): Contact => contacts.update(id, version, patch),
      byAccount: (accountId: string): Contact | undefined =>
        contacts.select('account_id = $account_id', { account_id: accountId }, { limit: 1 })[0],
      /** 全部（列表、档位页的人数），最近说过话的在前；只在群里见过的（member）不算。 */
      all: (): Contact[] => allPages((page) => contacts.select("state <> 'member' AND removed_at IS NULL", {}, page,
        'last_at DESC, id')),
      /** 绑了这一页人物的联系人。 */
      forPersonDoc: (docId: string): Contact[] => contacts.select('person_doc_id = $doc AND removed_at IS NULL',
        { doc: docId }),
      /** 「最近删除」：删掉的联系人，新删的在前。 */
      removed: (): Contact[] => contacts.select('removed_at IS NOT NULL', {}, { limit: 200 }, 'removed_at DESC, id'),
      /** 互加了的好友（发资料、头像给他们）。 */
      active: (): Contact[] => allPages((page) => contacts.select("state = 'active' AND removed_at IS NULL", {}, page,
        'last_at DESC, id')),
    },
  };
}

export type NetworkStores = ReturnType<typeof createNetworkStores>;
