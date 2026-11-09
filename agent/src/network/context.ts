// network/ 里各部分共用的东西：库、时钟、卡桌、开线、记成来源、告诉界面、中继客户端、叫发件箱起来干活。
// 由 service.ts 组好，往下传；各部分不自己去拿别的模块。

import type { LineStatus } from '../../shared/api/lines.ts';
import type { NetworkTaskExecution } from '../../shared/api/contacts.ts';
import type { Contact, ContactMessage, NetworkIdentity } from '../../shared/state.ts';
import type { AskDesk } from '../attention/index.ts';
import type { StateService } from '../state/index.ts';
import { NetworkError } from './errors.ts';
import type { RelayClient, Signer } from '../../protocol/relay-client.ts';

/**
 * 一次改动碰到的联系人（或群）和它聊天里的哪几项（界面据此推 contacts_changed / contact_item）。群的改动 groupId
 * 有值、contactId 是空串；messageIds 是群消息的 id。
 */
export interface NetworkChange {
  contactId: string;
  messageIds: readonly string[];
  taskIds: readonly string[];
  groupId?: string;
}

/**
 * 「让 Plasticine 做」开的那条后台线（新内核 lines/，2026-11-05 Harness 重做后不再建本机任务）。由 app/ 接到 LineKernel。
 */
export interface NetworkLines {
  /**
   * 开一条后台线，返回线的 id；推事件、开跑放在 after（提交以后）。sealedPrompt：替别人答话的线（responder.ts），
   * 系统提示只用它、不给工具。
   */
  open(input: { title: string; goal: string; sealedPrompt?: string }, after: (action: () => void) => void): string;
  /** 修改意见写回原线；消息随事务保存、提交后开跑，不能自行解除用户暂停。 */
  send(lineId: string, text: string, after: (action: () => void) => void): void;
  /** 线做完了没有：做完了是它最后那段话；还在做、没做成是 null。 */
  answer(lineId: string): string | null;
  /** 线现在的状态；没有这条线是 null。 */
  status(lineId: string): LineStatus | null;
  /** 本机执行状态；不复制成跨用户任务的业务进度。 */
  execution(lineId: string): NetworkTaskExecution | null;
  /** 线这会儿在做的那一步（任务卡上「在核对营业时间…」）；不在跑是 null。 */
  activity(lineId: string): { text: string; since: string } | null;
  /** 叫停（「停止」）。 */
  halt(lineId: string): void;
  /** 等所有线停下来（测试）。 */
  settled(): Promise<void>;
}

export interface NetworkContext {
  state: StateService;
  now: () => Date;
  newId: () => string;
  desk: AskDesk;
  lines: NetworkLines;
  /** 收到的人话、AI 话记成来源（app/ 接到进门的触发）。 */
  recordSource: (message: ContactMessage, contact: Contact) => void;
  /** 提交以后才调。 */
  changed: (change: NetworkChange) => void;
  /** 照这台实例加入时的中继地址（没加入时用配置的默认地址）。 */
  relay: () => RelayClient;
  /** 有新信要发：发件箱尽快发一轮（关着自动同步时什么都不做，测试自己 flush）。 */
  kickOutbox: () => void;
  /** 替主人答话开不开线（false = 不调模型，拿不准一律问主人；测试默认这样）。 */
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

/** 联系人最近一次有动静的时间往前走（列表按它排）。 */
export function touchContact(context: Pick<NetworkContext, 'state'>, contactId: string, at: string): Contact {
  const current = context.state.contacts.require(contactId);
  return at > current.lastAt ? context.state.contacts.update(current.id, current.version, { lastAt: at }) : current;
}
