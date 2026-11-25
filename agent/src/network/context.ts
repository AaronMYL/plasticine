import type { LineStatus } from '../../shared/api/lines.ts';
import type { NetworkTaskExecution } from '../../shared/api/contacts.ts';
import type { Contact, NetworkIdentity } from '../../shared/state.ts';
import type { AskDesk } from '../attention/index.ts';
import type { StateService } from '../state/index.ts';
import { NetworkError } from './errors.ts';
import type { RelayClient, Signer } from '../../protocol/relay-client.ts';

export interface NetworkChange {
  contactId: string;
  messageIds: readonly string[];
  taskIds: readonly string[];
  groupId?: string;
}

export interface NetworkLines {
  open(input: { title: string; goal: string; sealedPrompt?: string }, after: (action: () => void) => void): string;
  send(lineId: string, text: string, after: (action: () => void) => void): void;
  answer(lineId: string): string | null;
  status(lineId: string): LineStatus | null;
  execution(lineId: string): NetworkTaskExecution | null;
  activity(lineId: string): { text: string; since: string } | null;
  halt(lineId: string): void;
  settled(): Promise<void>;
}

export interface NetworkContext {
  prepareAttachments?: (messageId: string) => Promise<void>;
  state: StateService;
  now: () => Date;
  newId: () => string;
  desk: AskDesk;
  lines: NetworkLines;
  changed: (change: NetworkChange) => void;
  relay: () => RelayClient;
  kickOutbox: () => void;
  responder: boolean;
}

export function requireIdentity(context: Pick<NetworkContext, 'state'>): NetworkIdentity {
  const identity = context.state.networkIdentity.get();
  if (identity === undefined) {
    throw new NetworkError('not_joined', '还没加入 Cyber Hunter 网络。先在「设置 · 账号与网络」里加入。');
  }
  return identity;
}

export function signerOf(identity: NetworkIdentity): Signer {
  return { accountId: identity.accountId, signingPrivateKey: identity.signingPrivateKey };
}

export function requireContact(context: Pick<NetworkContext, 'state'>, contactId: string): Contact {
  const contact = context.state.contacts.get(contactId);
  if (contact === undefined) {
    throw new NetworkError('not_found', '没有这个联系人。');
  }
  return contact;
}

export function changeOf(contactId: string, messageIds: readonly string[] = [], taskIds: readonly string[] = []):
  NetworkChange {
  return { contactId, messageIds, taskIds };
}

export function groupChange(groupId: string, messageIds: readonly string[] = [], taskIds: readonly string[] = []):
  NetworkChange {
  return { contactId: '', groupId, messageIds, taskIds };
}

export function touchContact(context: Pick<NetworkContext, 'state'>, contactId: string, at: string): Contact {
  const current = context.state.contacts.require(contactId);
  return at > current.lastAt ? context.state.contacts.update(current.id, current.version, { lastAt: at }) : current;
}
