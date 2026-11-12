// 这台实例在 Cyber Hunter 网络上的那一头（第 113 条）：加入网络、邀请码、联系人、发信收信、分身、跨用户任务。
// app/ 的接口只通过这里；没加入网络时同步循环不跑，联系人接口回「还没加入」。

import { randomUUID } from 'node:crypto';
import { tunnelHost } from '../../shared/tunnel-wire.ts';
import { NetworkAttachments } from './attachments.ts';
import type { NetInvite } from '../../shared/net-wire.ts';
import type { NetworkTaskExecution } from '../../shared/api/contacts.ts';
import type { HandleAvailability } from '../../shared/api/account.ts';
import type { Contact, ContactMessage, Group, GroupMessage, GroupTask, NetworkIdentity,
  NetworkTask } from '../../shared/state.ts';
import type { AskDesk, AskResolver, Changes } from '../attention/index.ts';
import type { DriveOutcome } from '../lines/index.ts';
import { errorCategory, safeLog } from '../shared-log.ts';
import { StateError, type StateService } from '../state/index.ts';
import { addContact, confirmSafety, decideRequest, markRead, normalizeHandle, sendMessage, setRelation,
  type AddContactInput,
  type RelationChange, type RequestDecision, type SendInput } from './contacts.ts';
import { changeOf, groupChange, requireContact, requireIdentity, signerOf, type NetworkChange, type NetworkContext,
  type NetworkLines } from './context.ts';
import { cancelGroupTask, claimGroupTask, offerGroupTask, type GroupTaskInput } from './group-tasks.ts';
import { afterGroup, createGroup, leaveGroup, postGroupMessage, requireGroup, updateGroup, type CreateGroupInput,
  type UpdateGroupInput } from './groups.ts';
import { broadcastProfile, renameProfile } from './profile.ts';
import { generateIdentityKeys } from '../../protocol/crypto.ts';
import { NetworkError } from './errors.ts';
import { Inbound } from './inbound.ts';
import { Outbox } from './outbox.ts';
import { Responder } from './responder.ts';
import { checkRelayUrl, DEFAULT_RELAY_URL, effectiveRelayUrl, RelayCallError, RelayClient,
  type Signer } from '../../protocol/relay-client.ts';
import { SyncLoop } from './sync.ts';
import { cancelTask, decideTask, deliverFinishedLocal, deliverTask, networkTaskResolver, offerTask, stopLocalTask,
  verdictTask, type OfferInput, type TaskDecision, type TaskVerdict } from './tasks.ts';
import { groupReplyKey, reactInGroup, reactToContact, removeContact, restoreContact, setAlias }
  from './contact-edits.ts';
import type { NET_REACTIONS } from '../../shared/net-wire.ts';

/** 测试等线停下时最多绕这么多圈（一轮答完可能又开下一条线）。 */
const SETTLE_ROUNDS_MAX = 20;
/** 长轮询默认等满 25 秒（shared/net-wire.ts NET_WAIT_MAX_SECONDS）。 */
export const DEFAULT_POLL_WAIT_SECONDS = 25;

export interface NetworkServiceOptions {
  state: StateService;
  now: () => Date;
  desk: AskDesk;
  lines: NetworkLines;
  /** PLASTICINE_NETWORK_URL；加入时可以另给。 */
  relayUrl: string;
  /** 邀请朋友的那句话里写的中继地址：自己走回环时，朋友要用公网的那个。 */
  publicRelayUrl?: string;
  /** 加入网络以后（隧道据此马上去连，不等下一次轮询）。 */
  onJoined?: () => void;
  fetch?: typeof fetch;
  /** 加入以后自己收发（线上）；测试关掉，手动 syncOnce / flushOutbox。 */
  autoSync: boolean;
  pollWaitSeconds?: number;
  /** 替主人答话开不开线（线上开；测试默认关，拿不准一律问主人）。 */
  responder: boolean;
  recordSource: (message: ContactMessage, contact: Contact) => void;
  changed: (change: NetworkChange) => void;
  newId?: () => string;
}

export interface JoinInput {
  handle: string;
  displayName: string;
  inviteCode: string | null;
  relayUrl: string | null;
}

/** 中继地址是不是本机回环（中继按这个认第一个账号；邀请的话里换成对外地址）。地址写错了算不是。 */
export function isLoopback(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
  } catch {
    return false;
  }
}

function relayFailure(error: unknown): never {
  if (error instanceof RelayCallError) {
    throw error.kind === 'refused' ? new NetworkError('relay_refused', error.message)
      : new NetworkError('relay_unreachable', '连不上 Cyber Hunter 中继，这次没做成。核对中继地址，稍后再试。');
  }
  throw error;
}

function checkVersion(task: NetworkTask, version: number): void {
  if (task.version !== version) {
    throw new StateError('version_conflict', '这项任务在别处改过了', { currentVersion: task.version });
  }
}

export class NetworkService {
  readonly attachments: NetworkAttachments;
  readonly #options: NetworkServiceOptions;
  readonly #context: NetworkContext;
  readonly #outbox: Outbox;
  readonly #responder: Responder;
  readonly #sync: SyncLoop;
  readonly #clients = new Map<string, RelayClient>();
  readonly #ending = new Set<Promise<void>>();

  constructor(options: NetworkServiceOptions) {
    this.#options = options;
    this.attachments = new NetworkAttachments(options.state, options.now,
      (handle) => this.publicHost(handle), options.fetch ?? fetch);
    this.#context = {
      state: options.state,
      now: options.now,
      newId: options.newId ?? randomUUID,
      desk: options.desk,
      lines: options.lines,
      recordSource: options.recordSource,
      changed: options.changed,
      relay: () => this.#client(this.relayUrl()),
      kickOutbox: () => this.#sync.kick(),
      responder: options.responder,
      prepareAttachments: (id) => this.attachments.prepare(id),
    };
    this.#outbox = new Outbox(this.#context);
    this.#responder = new Responder(this.#context);
    this.#sync = new SyncLoop(this.#context, { inbound: new Inbound(this.#context), outbox: this.#outbox,
      responder: this.#responder }, { autoSync: options.autoSync,
      pollWaitSeconds: options.pollWaitSeconds ?? DEFAULT_POLL_WAIT_SECONDS,
      afterSync: () => this.#deliverPending() });
  }

  #client(url: string): RelayClient {
    const base = checkRelayUrl(url);
    let client = this.#clients.get(base);
    if (client === undefined) {
      client = new RelayClient({ baseUrl: base, now: this.#options.now,
        ...(this.#options.fetch === undefined ? {} : { fetch: this.#options.fetch }) });
      this.#clients.set(base, client);
    }
    return client;
  }

  get defaultRelayUrl(): string {
    return checkRelayUrl(this.#options.relayUrl);
  }

  identity(): NetworkIdentity | undefined {
    return this.#options.state.networkIdentity.get();
  }

  /** 实际在用的中继地址（加入时记下的；中继独立以前的旧地址换成配置的，见 relay-client.ts）。 */
  relayUrl(): string {
    return effectiveRelayUrl(this.identity()?.relayUrl, this.#options.relayUrl);
  }

  /** 这台实例的账号签名钥匙；没加入网络是 null（隧道据此决定连不连）。 */
  signer(): Signer | null {
    const identity = this.identity();
    return identity === undefined ? null : signerOf(identity);
  }

  // ---------- 生命周期 ----------

  start(): void {
    try {
      this.#responder.recover();
    } catch (error) {
      safeLog('error', 'network_responder_failed', { category: errorCategory(error) });
    }
    this.#sync.start();
  }

  async stop(): Promise<void> {
    await this.#sync.stop();
  }

  /** 等替人答话、做任务的线都停下，停下以后的收尾也做完（测试）。 */
  async settled(): Promise<void> {
    for (let round = 0; round < SETTLE_ROUNDS_MAX; round += 1) {
      await this.#options.lines.settled();
      if (this.#ending.size === 0) {
        return;
      }
      await Promise.allSettled([...this.#ending]);
    }
  }

  #later(work: () => void): void {
    const done = new Promise<void>((resolve) => {
      setImmediate(() => {
        try {
          work();
        } finally {
          resolve();
        }
      });
    });
    this.#ending.add(done);
    void done.finally(() => this.#ending.delete(done));
  }

  syncOnce(waitSeconds = 0): Promise<number> {
    return this.#sync.syncOnce(waitSeconds);
  }

  flushOutbox(): Promise<number> {
    return this.#sync.flush();
  }

  // ---------- 账号 ----------

  /** 加入网络：本机生成两对钥匙，到中继注册（用新钥匙签），记下账号。同一个 handle 再来拿回原来那个。 */
  async join(input: JoinInput): Promise<NetworkIdentity> {
    const { state, now } = this.#options;
    const existing = state.networkIdentity.get();
    if (existing !== undefined) {
      if (existing.handle === input.handle) {
        return existing;
      }
      throw new NetworkError('already_joined', `这台 Plasticine 已经以 @${existing.handle} 加入网络了。`);
    }
    let relayUrl: string;
    try {
      relayUrl = checkRelayUrl(input.relayUrl ?? this.#options.relayUrl);
    } catch {
      throw new NetworkError('invalid_input', '中继地址要是 http(s) 地址。', 'relayUrl');
    }
    const keys = generateIdentityKeys();
    const { account, invitedBy } = await this.#client(relayUrl).registerFor({ handle: input.handle,
      displayName: input.displayName,
      signingKey: keys.signing.publicKey, encryptionKey: keys.encryption.publicKey,
      ...(input.inviteCode === null || input.inviteCode.trim() === '' ? {} : { inviteCode: input.inviteCode }) },
    keys.signing.privateKey).catch(relayFailure);
    const identity = state.networkIdentity.create({ accountId: account.id, handle: account.handle,
      displayName: account.displayName, relayUrl, signingPublicKey: keys.signing.publicKey,
      signingPrivateKey: keys.signing.privateKey, encryptionPublicKey: keys.encryption.publicKey,
      encryptionPrivateKey: keys.encryption.privateKey, joinedAt: now().toISOString() });
    this.#sync.wake();
    this.#options.onJoined?.();
    if (invitedBy !== null) {
      // 用谁的邀请码进来的，就先给谁发一个好友请求（他那边是一条新请求，接受就互加了）。
      await addContact(this.#context, { handle: invitedBy, note: '用你的邀请码加入了', requestId: `invited-${account.id}` })
        .catch((error: unknown) => {
          safeLog('warn', 'network_send_failed', { category: errorCategory(error) });
        });
    }
    return identity;
  }

  async createInvite(requestId: string): Promise<{ invite: NetInvite; shareText: string }> {
    const identity = requireIdentity(this.#context);
    const invite = await this.#context.relay().createInvite(signerOf(identity), requestId).catch(relayFailure);
    const relay = isLoopback(this.relayUrl()) ? this.#options.publicRelayUrl ?? DEFAULT_RELAY_URL
      : this.relayUrl();
    // 2026-11-05 设计稿 Invite：三行，朋友照着装、填码；加入以后自动给我发好友请求。
    const shareText = `我在用 Plasticine，邀请你加入。\n下载：${new URL('/download/', relay).toString()}\n`
      + `装好后填邀请码 ${invite.code}`;
    return { invite, shareText };
  }

  async invites(): Promise<NetInvite[]> {
    const identity = requireIdentity(this.#context);
    return this.#context.relay().invites(signerOf(identity)).catch(relayFailure);
  }

  /** 朋友加我、手机打开用的名字：<handle>.<中继主域名>（自己走回环时用对外的那个中继地址）。 */
  publicHost(handle: string): string {
    const relay = isLoopback(this.relayUrl()) ? this.#options.publicRelayUrl ?? DEFAULT_RELAY_URL : this.relayUrl();
    return tunnelHost(handle, new URL(relay).hostname);
  }

  // ---------- 联系人 ----------

  /** 加好友表单下面那张预览：按填的那一串（@handle 或链接）在中继上找人。找不到是 null。 */
  async lookup(input: string): Promise<{ handle: string; displayName: string; accountId: string } | null> {
    const identity = requireIdentity(this.#context);
    const handle = normalizeHandle(input);
    if (handle === null) {
      return null;
    }
    try {
      const account = await this.#context.relay().account(signerOf(identity), handle);
      return { handle: account.handle, displayName: account.displayName, accountId: account.id };
    } catch (error) {
      if (error instanceof RelayCallError && error.kind === 'refused' && error.status === 404) {
        return null;
      }
      return relayFailure(error);
    }
  }

  addContact(input: AddContactInput): Promise<Contact> {
    return addContact(this.#context, input);
  }

  decideRequest(contactId: string, decision: RequestDecision): Promise<Contact> {
    return decideRequest(this.#context, contactId, decision);
  }

  setRelation(contactId: string, change: RelationChange): Contact {
    return setRelation(this.#context, contactId, change);
  }

  markRead(contactId: string, upTo: string): number {
    return markRead(this.#context, contactId, upTo);
  }

  confirmSafety(contactId: string, version: number): Contact {
    return confirmSafety(this.#context, contactId, version);
  }

  /** 发一句；target = mine 是 @ 自己的 Plasticine（发出这句后它照对面能听到的档位答）。 */
  sendMessage(contactId: string, input: SendInput): ContactMessage {
    const message = sendMessage(this.#context, contactId, input);
    if (input.target === 'mine') {
      this.#responder.selfInChat(message.id);
    }
    return message;
  }

  retryMessage(threadId: string, messageId: string): ContactMessage | GroupMessage {
    const context = this.#context;
    const identity = requireIdentity(context);
    const group = context.state.groupMessages.get(messageId);
    const message = group ?? context.state.contactMessages.require(messageId);
    if (group !== undefined) requireGroup(context, threadId);
    else {
      const contact = requireContact(context, threadId);
      if (contact.state === 'blocked' || contact.safetyChanged) {
        throw new NetworkError('conflict', '联系人已被拉黑或安全码待核对，这次没有重发。');
      }
    }
    const outgoing = group === undefined ? [message as ContactMessage]
      : context.state.contactMessages.forGroupMessage(group.groupId, group.messageId);
    if (group === undefined ? (message as ContactMessage).contactId !== threadId
        || (message as ContactMessage).direction !== 'out'
      : group.groupId !== threadId || group.authorAccountId !== identity.accountId) {
      throw new NetworkError('not_found', '没有这条可重试的消息。');
    }
    context.desk.commit((changes) => {
      for (const row of outgoing) {
        if (row.status !== 'failed') continue;
        context.state.contactMessages.update(row.id, row.version,
          { status: 'sending', attempts: 0, error: null, nextAttemptAt: null });
      }
      changes.afterCommit(() => {
        context.kickOutbox();
        context.changed(group === undefined ? changeOf(threadId, [messageId]) : groupChange(threadId, [messageId]));
      });
    });
    return group ?? context.state.contactMessages.require(messageId);
  }

  // ---------- 头像 ----------

  /** 改网络上的名字，发给每个好友（主人账号改名时一起改，app/account.ts）。 */
  rename(displayName: string): NetworkIdentity {
    return renameProfile(this.#context, displayName);
  }

  /**
   * 起 @账号前问中继这个名字能不能用（2026-11-08 自助注册）。中继连不上、出错、太旧没有这个接口都回 unreachable：
   * 界面照常让他填，真注册时中继再说。
   */
  async handleAvailability(handle: string): Promise<HandleAvailability> {
    try {
      return await this.#client(this.relayUrl()).handleAvailability(handle);
    } catch (error) {
      if (error instanceof RelayCallError) {
        safeLog('warn', 'network_handle_check_failed', { category: errorCategory(error) });
        return { handle, available: false, reason: 'unreachable' };
      }
      throw error;
    }
  }

  /** 换头像（data URL，界面裁好的圆形小图；null = 去掉），加密发给每个好友。 */
  setAvatar(avatar: string | null): NetworkIdentity {
    return broadcastProfile(this.#context, avatar);
  }

  // ---------- 群 ----------

  createGroup(input: CreateGroupInput): Group {
    return createGroup(this.#context, input);
  }

  updateGroup(groupId: string, input: UpdateGroupInput): Group {
    return updateGroup(this.#context, groupId, input);
  }

  leaveGroup(groupId: string): Group {
    return leaveGroup(this.#context, groupId);
  }

  /** 在群里说一句；aiOf = 问谁的 Plasticine（账号 id，可以是自己）。 */
  postToGroup(groupId: string, input: { text: string; aiOf: string | null; requestId: string;
    attachmentIds?: string[]; replyToId?: string })
    : GroupMessage {
    const context = this.#context;
    const identity = requireIdentity(context);
    const group = requireGroup(context, groupId);
    if (input.aiOf !== null && context.state.groupMembers.get(group.id, input.aiOf)?.leftAt !== null) {
      throw new NetworkError('invalid_input', '只能 @ 群里的人的 Plasticine。', 'aiOf');
    }
    const message = context.desk.commit((changes) => {
      const exchangeId = input.aiOf === null ? null : context.newId();
      const posted = postGroupMessage(context, changes, group, { kind: input.aiOf === null ? 'text' : 'ask_ai',
        text: input.text, target: input.aiOf, exchangeId, author: 'me', requestId: input.requestId,
        replyTo: groupReplyKey(context, group.id, input.replyToId),
        ...(input.attachmentIds === undefined ? {} : { attachmentIds: input.attachmentIds }) });
      if (posted === null) {
        throw new NetworkError('conflict', '这句没发出去。');
      }
      return posted;
    });
    if (input.aiOf === identity.accountId) {
      this.#responder.askedInGroup(message.id);
    }
    return message;
  }

  /** 给一句话加 / 拿掉一个表情（第 12 批）：threadId 是联系人或群。 */
  react(threadId: string, messageId: string, emoji: (typeof NET_REACTIONS)[number], on: boolean): void {
    const group = this.#context.state.groupMessages.get(messageId);
    if (group !== undefined) reactInGroup(this.#context, threadId, group, emoji, on);
    else reactToContact(this.#context, threadId, messageId, emoji, on);
  }

  setAlias(contactId: string, version: number, alias: string | null): Contact {
    return setAlias(this.#context, contactId, version, alias);
  }

  removeContact(contactId: string): Contact {
    return removeContact(this.#context, contactId);
  }

  restoreContact(contactId: string): Contact {
    return restoreContact(this.#context, contactId);
  }

  markGroupRead(groupId: string, upTo: string): number {
    const marked = this.#context.state.groupMessages.markRead(groupId, upTo, this.#context.now().toISOString());
    if (marked > 0) {
      this.#context.desk.commit((changes) => afterGroup(this.#context, changes, groupId, []));
    }
    return marked;
  }

  offerGroupTask(groupId: string, input: GroupTaskInput): GroupTask {
    return offerGroupTask(this.#context, groupId, input);
  }

  claimGroupTask(taskId: string, doer: 'ai' | 'person'): GroupTask {
    return claimGroupTask(this.#context, taskId, doer);
  }

  cancelGroupTask(taskId: string): GroupTask {
    return cancelGroupTask(this.#context, taskId);
  }

  // ---------- 跨用户任务 ----------

  offerTask(contactId: string, input: OfferInput): NetworkTask {
    requireIdentity(this.#context);
    const contact = requireContact(this.#context, contactId);
    if (contact.state === 'blocked' || contact.safetyChanged) {
      throw new NetworkError('conflict', '现在不能给这个人发任务（拉黑了，或安全码变了没核对）。');
    }
    return this.#commitTask(() => offerTask(this.#context, contact, input));
  }

  decideTask(taskId: string, version: number, decision: TaskDecision): NetworkTask {
    return this.#commitTask((changes) => {
      checkVersion(this.#requireTask(taskId), version);
      return decideTask(this.#context, changes, taskId, decision);
    });
  }

  deliverTask(taskId: string, version: number, text: string): NetworkTask {
    return this.#commitTask((changes) => {
      checkVersion(this.#requireTask(taskId), version);
      return deliverTask(this.#context, changes, taskId, text, 'me');
    });
  }

  /** 撤回我发出、对方还没点头的任务。 */
  cancelTask(taskId: string, version: number): NetworkTask {
    return this.#commitTask((changes) => {
      checkVersion(this.#requireTask(taskId), version);
      return cancelTask(this.#context, changes, taskId);
    });
  }

  /** 叫停本机 Plasticine 在做的任务，改成我自己做。 */
  stopTask(taskId: string, version: number): NetworkTask {
    return this.#commitTask((changes) => {
      checkVersion(this.#requireTask(taskId), version);
      return stopLocalTask(this.#context, changes, taskId);
    });
  }

  /** 本机 Plasticine 在做这项任务时，这会儿在做的那一步。 */
  taskActivity(task: NetworkTask): { text: string; since: string } | null {
    return task.direction === 'in' && task.doer === 'ai' && task.localTaskId !== null
      ? this.#options.lines.activity(task.localTaskId) : null;
  }

  taskExecution(task: NetworkTask): NetworkTaskExecution | null {
    return task.direction === 'in' && task.doer === 'ai' && task.localTaskId !== null
      ? this.#options.lines.execution(task.localTaskId) : null;
  }

  /** 首页和任务卡看的是同一条线；暂停、恢复、失败只更新执行投影，不擅自改成「我来做」。 */
  lineChanged(lineId: string): void {
    const task = this.#options.state.networkTasks.byLocalTask(lineId);
    if (task?.direction === 'in' && task.doer === 'ai') {
      this.#context.changed(task.groupId === null ? changeOf(task.contactId, [], [task.id])
        : groupChange(task.groupId, [], [task.id]));
    }
  }

  verdictTask(taskId: string, version: number, verdict: TaskVerdict, note: string): NetworkTask {
    return this.#commitTask((changes) => {
      checkVersion(this.#requireTask(taskId), version);
      return verdictTask(this.#context, changes, taskId, verdict, note);
    });
  }

  #requireTask(taskId: string): NetworkTask {
    const task = this.#options.state.networkTasks.get(taskId);
    if (task === undefined) {
      throw new NetworkError('not_found', '没有这项任务。');
    }
    return task;
  }

  #commitTask(work: (changes: Changes) => NetworkTask): NetworkTask {
    return this.#options.desk.commit((changes) => {
      const result = work(changes);
      changes.afterCommit(() => {
        this.#sync.kick();
        this.#context.changed(result.groupId === null ? changeOf(result.contactId, [], [result.id])
          : { ...changeOf('', [], [result.id]), groupId: result.groupId });
      });
      return result;
    });
  }

  /**
   * 一条线停下了（app/ 接在新内核的 turnEnded 上）：替人答话的线把回答发出去（没答成也收尾）；别人发来的任务开的线
   * 做完了，交付发回去。
   */
  lineEnded(lineId: string, outcome: DriveOutcome): void {
    this.lineChanged(lineId);
    if (outcome !== 'paused' && outcome !== 'shutdown') {
      this.#later(() => {
        try {
          this.#responder.lineEnded(lineId);
        } catch (error) {
          safeLog('error', 'network_responder_failed', { objectId: lineId, category: errorCategory(error) });
        }
      });
    }
    if (outcome === 'done') {
      this.#later(() => this.#deliver([lineId]));
    }
  }

  #deliverPending(): void {
    this.#deliver(this.#options.state.networkTasks.awaitingLocal().flatMap((task) =>
      task.localTaskId === null ? [] : [task.localTaskId]));
  }

  #deliver(lineIds: string[]): void {
    try {
      const changes = deliverFinishedLocal(this.#context, lineIds);
      for (const change of changes) {
        this.#context.changed(change);
      }
      if (changes.length > 0) {
        this.#sync.kick();
      }
    } catch (error) {
      safeLog('error', 'network_delivery_failed', { category: errorCategory(error) });
    }
  }

  /** 卡桌上两种卡的去处（app/assemble.ts 接进 routeAsks）。 */
  resolvers(): { network_task: AskResolver; network_reply: AskResolver } {
    return { network_task: networkTaskResolver(this.#context), network_reply: this.#responder.resolver() };
  }
}
