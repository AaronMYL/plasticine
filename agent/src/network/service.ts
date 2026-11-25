import { randomUUID } from 'node:crypto';
import { tunnelHost } from '../../shared/tunnel-wire.ts';
import { NetworkAttachments } from './attachments.ts';
import type { NET_REACTIONS, NetInvite } from '../../shared/net-wire.ts';
import type { NetworkTaskExecution } from '../../shared/api/contacts.ts';
import type { HandleAvailability } from '../../shared/api/account.ts';
import type { Contact, ContactMessage, Group, GroupMessage, GroupTask, NetworkIdentity,
  NetworkTask } from '../../shared/state.ts';
import type { AskDesk, AskResolver, Changes } from '../attention/index.ts';
import type { DriveOutcome } from '../lines/index.ts';
import { errorCategory, safeLog } from '../util/index.ts';
import { StateError, type StateService } from '../state/index.ts';
import { addContact, confirmSafety, decideRequest, markRead, normalizeHandle, sendMessage, setRelation,
  type AddContactInput,
  type RelationChange, type RequestDecision, type SendInput } from './contacts.ts';
import { changeOf, groupChange, requireContact, requireIdentity, signerOf, type NetworkChange, type NetworkContext,
  type NetworkLines } from './context.ts';
import { cancelGroupTask, claimGroupTask, offerGroupTask, type GroupTaskInput } from './group-tasks.ts';
import { afterGroup, createGroup, leaveGroup, postGroupMessage, requireGroup, updateGroup, type CreateGroupInput,
  type UpdateGroupInput } from './groups.ts';
import { broadcastProfile, refreshProfile, renameProfile } from './profile.ts';
import { NetworkError } from './errors.ts';
import { Inbound } from './inbound.ts';
import { Outbox } from './outbox.ts';
import { Responder } from './responder.ts';
import { checkRelayUrl, DEFAULT_RELAY_URL, effectiveRelayUrl, RelayCallError, RelayClient,
  type Signer } from '../../protocol/relay-client.ts';
import { registerIdentity, relayFailure } from './register.ts';
import { SyncLoop } from './sync.ts';
import { cancelTask, decideTask, deliverFinishedLocal, deliverTask, networkTaskResolver, offerTask, stopLocalTask,
  verdictTask, type OfferInput, type TaskDecision, type TaskVerdict } from './tasks.ts';
import { groupReplyKey, reactInGroup, reactToContact, removeContact, restoreContact, setAlias }
  from './contact-edits.ts';

const SETTLE_ROUNDS_MAX = 20;
export const DEFAULT_POLL_WAIT_SECONDS = 25;

export interface NetworkServiceOptions {
  state: StateService;
  now: () => Date;
  desk: AskDesk;
  lines: NetworkLines;
  relayUrl: string;
  publicRelayUrl?: string;
  onJoined?: () => void;
  fetch?: typeof fetch;
  autoSync: boolean;
  pollWaitSeconds?: number;
  responder: boolean;
  changed: (change: NetworkChange) => void;
  newId?: () => string;
}

export interface JoinInput {
  handle: string;
  displayName: string;
  inviteCode: string | null;
  relayUrl: string | null;
}

export function isLoopback(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
  } catch {
    return false;
  }
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

  relayUrl(): string {
    return effectiveRelayUrl(this.identity()?.relayUrl, this.#options.relayUrl);
  }

  signer(): Signer | null {
    const identity = this.identity();
    return identity === undefined ? null : signerOf(identity);
  }

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

  async join(input: JoinInput): Promise<NetworkIdentity> {
    const { state, now } = this.#options;
    const existing = state.networkIdentity.get();
    if (existing !== undefined && existing.handle !== input.handle) {
      throw new NetworkError('already_joined', `这台 Plasticine 已经以 @${existing.handle} 加入网络了。`);
    }
    let relayUrl: string;
    try {
      relayUrl = checkRelayUrl(existing?.relayUrl ?? input.relayUrl ?? this.#options.relayUrl);
    } catch {
      throw new NetworkError('invalid_input', '中继地址要是 http(s) 地址。', 'relayUrl');
    }
    const { identity, invitedBy, fresh } = await registerIdentity(state, this.#client(relayUrl),
      { handle: input.handle, displayName: input.displayName, inviteCode: input.inviteCode, relayUrl }, now());
    if (!fresh) {
      return identity;
    }
    this.#sync.wake();
    this.#options.onJoined?.();
    if (invitedBy !== null) {
      await addContact(this.#context, { handle: invitedBy, note: '用你的邀请码加入了',
        requestId: `invited-${identity.accountId}` })
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
    const shareText = `我在用 Plasticine，邀请你加入。\n下载：${new URL('/download/', relay).toString()}\n`
      + `装好后填邀请码 ${invite.code}`;
    return { invite, shareText };
  }

  async invites(): Promise<NetInvite[]> {
    const identity = requireIdentity(this.#context);
    return this.#context.relay().invites(signerOf(identity)).catch(relayFailure);
  }

  publicHost(handle: string): string {
    const relay = isLoopback(this.relayUrl()) ? this.#options.publicRelayUrl ?? DEFAULT_RELAY_URL : this.relayUrl();
    return tunnelHost(handle, new URL(relay).hostname);
  }

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

  rename(displayName: string): NetworkIdentity {
    return renameProfile(this.#context, displayName);
  }

  refreshProfile(): NetworkIdentity {
    return refreshProfile(this.#context);
  }

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

  setAvatar(avatar: string | null): NetworkIdentity {
    return broadcastProfile(this.#context, avatar);
  }

  createGroup(input: CreateGroupInput): Group {
    return createGroup(this.#context, input);
  }

  updateGroup(groupId: string, input: UpdateGroupInput): Group {
    return updateGroup(this.#context, groupId, input);
  }

  leaveGroup(groupId: string): Group {
    return leaveGroup(this.#context, groupId);
  }

  postToGroup(groupId: string, input: { text: string; aiOf: string | null; alsoAiOf?: readonly string[];
    requestId: string; attachmentIds?: string[]; replyToId?: string })
    : GroupMessage {
    const context = this.#context;
    const identity = requireIdentity(context);
    const group = requireGroup(context, groupId);
    const more = input.aiOf === null || input.text.trim() === '' ? []
      : [...new Set(input.alsoAiOf ?? [])].filter((id) => id !== input.aiOf);
    for (const target of input.aiOf === null ? [] : [input.aiOf, ...more]) {
      if (context.state.groupMembers.get(group.id, target)?.leftAt !== null) {
        throw new NetworkError('invalid_input', '只能 @ 群里的人的 Plasticine。', 'aiOf');
      }
    }
    const replyTo = groupReplyKey(context, group.id, input.replyToId);
    const posted = context.desk.commit((changes) => {
      const first = postGroupMessage(context, changes, group, { kind: input.aiOf === null ? 'text' : 'ask_ai',
        text: input.text, target: input.aiOf, exchangeId: input.aiOf === null ? null : context.newId(), author: 'me',
        requestId: input.requestId, replyTo,
        ...(input.attachmentIds === undefined ? {} : { attachmentIds: input.attachmentIds }) });
      if (first === null) {
        throw new NetworkError('conflict', '这句没发出去。');
      }
      const rest = more.map((target) => postGroupMessage(context, changes, group, { kind: 'ask_ai',
        text: input.text, target, exchangeId: context.newId(), author: 'me',
        requestId: `${input.requestId}:${target}`, replyTo }));
      return { first, all: [first, ...rest.filter((message) => message !== null)] };
    });
    for (const message of posted.all) {
      if (message.targetAccountId === identity.accountId) {
        this.#responder.askedInGroup(message.id);
      }
    }
    return posted.first;
  }

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

  cancelTask(taskId: string, version: number): NetworkTask {
    return this.#commitTask((changes) => {
      checkVersion(this.#requireTask(taskId), version);
      return cancelTask(this.#context, changes, taskId);
    });
  }

  stopTask(taskId: string, version: number): NetworkTask {
    return this.#commitTask((changes) => {
      checkVersion(this.#requireTask(taskId), version);
      return stopLocalTask(this.#context, changes, taskId);
    });
  }

  taskActivity(task: NetworkTask): { text: string; since: string } | null {
    return task.direction === 'in' && task.doer === 'ai' && task.localTaskId !== null
      ? this.#options.lines.activity(task.localTaskId) : null;
  }

  taskExecution(task: NetworkTask): NetworkTaskExecution | null {
    return task.direction === 'in' && task.doer === 'ai' && task.localTaskId !== null
      ? this.#options.lines.execution(task.localTaskId) : null;
  }

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

  resolvers(): { network_task: AskResolver; network_reply: AskResolver } {
    return { network_task: networkTaskResolver(this.#context), network_reply: this.#responder.resolver() };
  }
}
