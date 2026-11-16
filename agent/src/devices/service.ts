// devices/ put together: the pairing and limits of nodes (pairing.ts) and their actions (actions.ts), over one state
// service, one transport and one clock. app/ attaches a sink so each change reaches the open streams after it commits.

import {
  NODE_ONLINE_MS, type NodeActionResultRequest, type NodeHelloRequest, type NodeLogUpload, type NodePairRequest,
  type NodeWireAction, type NodeWork,
} from '../../shared/api/index.ts';
import type { DeviceConfirmation, DeviceLimits, DeviceNode, NodePairingCode } from '../../shared/state.ts';
import { MAX_PAGE_SIZE, type StateService } from '../state/index.ts';
import type { AskDesk } from '../attention/index.ts';
import { settleScheduleSend } from '../outbound/index.ts';
import { DeviceActions, IDLE_SINK, type DeviceSink } from './actions.ts';
import { DeviceApprovals } from './approvals.ts';
import { DeviceLogs } from './device-logs.ts';
import { DeviceWaits } from './device-waits.ts';
import { NodeWorkBoard } from './node-work.ts';
import {
  authenticateNode,
  findNodeCode,
  helloNode,
  issueNodeCode,
  pairNode,
  reissueCredential,
  revokeNode,
  setNodeLimits,
  effectiveLimits,
  type IssuedNodeCode,
  type PairedNode,
  type PairingContext,
} from './pairing.ts';
import { PollingNodeTransport, type NodeTransport } from './transport.ts';

export interface DeviceServiceOptions {
  state: StateService;
  desk?: AskDesk;
  now?: () => Date;
  /** Optional test adapter; the default is the persistent long-poll channel. */
  transport?: NodeTransport;
  /** Development dry run of device actions (decisions 8 and 68). */
  dryRun: boolean;
  /** 第 102 条事与来源：节点从离线回到在线，记一条设备来源的触发（离线只在下次上线时算，见报告）。 */
  cameOnline?: (node: { id: string; name: string }, at: string) => void;
  /** 11-16：设备缓过来了（离线回来，或卡住后又空了）：等它的任务接着做（device-waits.ts）。 */
  cameBack?: (node: { id: string; name: string }, at: string) => void;
  /** 11-16：设备日志存在哪（不给就不收日志，测试用）。 */
  logsDirectory?: string;
}

/** 报到回复里给设备的：要不要传日志、哪些动作放下。 */
export interface HelloAnswer {
  node: DeviceNode;
  logsWanted: { requestId: string; since: string } | null;
  cancel: string[];
}

const ROUTINE_PUBLISH_MS = 60_000;

function workKey(work: NodeWork): string {
  return `${work.state}|${work.actionId ?? ''}|${work.step ?? ''}`;
}

export class DeviceService {
  readonly actions: DeviceActions;
  readonly channel: PollingNodeTransport;
  readonly approvals: DeviceApprovals | undefined;
  readonly #pairing: PairingContext;
  readonly #recovered: Set<string>;
  readonly #options: DeviceServiceOptions;
  readonly board = new NodeWorkBoard();
  readonly logs: DeviceLogs | null;
  readonly waits: DeviceWaits;
  readonly #published = new Map<string, number>();
  #sink: DeviceSink = IDLE_SINK;

  constructor(options: DeviceServiceOptions) {
    const now = options.now ?? (() => new Date());
    this.#pairing = { state: options.state, now };
    this.#options = options;
    this.logs = options.logsDirectory === undefined ? null : new DeviceLogs(options.logsDirectory, now);
    this.waits = new DeviceWaits(options.state, now);
    this.#recovered = new Set(options.state.nodeActions.pending().map((row) => row.actionId));
    this.channel = new PollingNodeTransport(options.state, now);
    this.actions = new DeviceActions({
      state: options.state,
      transport: options.transport ?? this.channel,
      now,
      dryRun: options.dryRun,
    });
    this.approvals = options.desk === undefined ? undefined : new DeviceApprovals(
      options.state, options.desk, this.actions, () => this.channel.wake(),
    );
    this.channel.attach((row) => {
      if (row.status === 'executed') {
        this.waits.done(row.runId, row.nodeId);
      }
      settleScheduleSend(options.state, row);
      this.#sink.actionRecorded(row);
      this.approvals?.settled(row);
      this.#settleRecovered(row.actionId);
    });
    // iPhone 排队的动作没有工具在等：回执到了照「接续」的路交回（第 102 条）。
    this.actions.onDetached((actionId) => { this.#recovered.add(actionId); });
    this.actions.attach({ nodeChanged: (id) => this.#sink.nodeChanged(id), actionRecorded: (row) => {
      settleScheduleSend(options.state, row);
      this.#sink.actionRecorded(row);
    } });
  }

  attach(sink: DeviceSink): void {
    this.#sink = sink;
  }

  nextAction(nodeId: string, wait: number, signal: AbortSignal): Promise<NodeWireAction | null> {
    const { state, now } = this.#pairing;
    const node = state.nodes.require(nodeId);
    const at = now();
    const wasOnline = at.getTime() - Date.parse(node.lastSeenAt) <= NODE_ONLINE_MS;
    state.nodes.update(node.id, node.version, { lastSeenAt: at.toISOString() });
    this.#publish(nodeId, !wasOnline, at);
    if (!wasOnline) {
      this.#options.cameOnline?.({ id: node.id, name: node.name }, at.toISOString());
      this.#options.cameBack?.({ id: node.id, name: node.name }, at.toISOString());
    }
    return this.channel.next(nodeId, wait, signal);
  }

  /** 推「设备变了」给界面：有变化马上推；只是又报到了一次，一分钟最多推一次（界面上的「刚刚」够用）。 */
  #publish(nodeId: string, changed: boolean, at: Date): void {
    const last = this.#published.get(nodeId) ?? Number.NEGATIVE_INFINITY;
    if (changed || at.getTime() - last >= ROUTINE_PUBLISH_MS) {
      this.#published.set(nodeId, at.getTime());
      this.#sink.nodeChanged(nodeId);
    }
  }

  /** 这台设备的动作通道这会儿在干什么。 */
  work(nodeId: string): NodeWork {
    return this.board.view(nodeId, this.#pairing.now());
  }

  /** 设备传上来的日志。 */
  receiveLogs(nodeId: string, upload: NodeLogUpload): void {
    this.logs?.receive(nodeId, upload);
  }

  reportResult(nodeId: string, actionId: string, body: NodeActionResultRequest): void {
    this.channel.report(nodeId, actionId, body);
  }

  stop(): void { this.channel.stop(); }

  listNodes() {
    const { state, now } = this.#pairing;
    const at = now().getTime();
    return state.nodes.list({ limit: MAX_PAGE_SIZE }).map((node) => ({ id: node.id, name: node.name,
      platform: node.platform, appVersion: node.appVersion, capabilities: node.capabilities,
      lastSeenAt: node.lastSeenAt, revokedAt: node.revokedAt,
      online: node.revokedAt === null && at - Date.parse(node.lastSeenAt) <= NODE_ONLINE_MS,
      work: this.work(node.id), limits: effectiveLimits(node) }));
  }

  /** 启动时：重启前还在路上的动作，回执到了（或已经到了）交回发起它的线。 */
  recover(): void {
    for (const actionId of this.#recovered) {
      this.#settleRecovered(actionId);
    }
  }

  #settleRecovered(actionId: string): void {
    if (!this.#recovered.has(actionId)) {
      return;
    }
    const row = this.#options.state.nodeActions.byActionId(actionId);
    if (row === undefined || row.status === 'queued' || row.status === 'sent') {
      return;
    }
    this.approvals?.settled(row);
    this.#recovered.delete(actionId);
  }

  issueCode(issuedByDeviceId: string): IssuedNodeCode {
    return issueNodeCode(this.#pairing, issuedByDeviceId);
  }

  voidCode(codeId: string): void {
    this.#pairing.state.nodePairingCodes.void(codeId, this.#pairing.now().toISOString());
  }

  findCode(typed: string): NodePairingCode | undefined {
    return findNodeCode(this.#pairing, typed);
  }

  pair(code: NodePairingCode, request: NodePairRequest): PairedNode {
    const paired = pairNode(this.#pairing, code, request);
    this.#sink.nodeChanged(paired.node.id);
    return paired;
  }

  reissue(nodeId: string): PairedNode {
    return reissueCredential(this.#pairing, nodeId);
  }

  authenticate(credential: string): DeviceNode | undefined {
    return authenticateNode(this.#pairing, credential);
  }

  hello(node: DeviceNode, hello: NodeHelloRequest): HelloAnswer {
    const at = this.#pairing.now();
    const wasOnline = at.getTime() - Date.parse(node.lastSeenAt) <= NODE_ONLINE_MS;
    const before = workKey(this.board.view(node.id, at));
    const updated = helloNode(this.#pairing, node, hello);
    const busy = hello.busy ?? null;
    const { wasStuck } = this.board.report(node.id, busy, at);
    this.channel.heard(node.id, busy?.actionId ?? null);
    // 每 20 秒一次报到，不是每次都推给界面：连上了、动作通道变了、版本或能力变了马上推，别的一分钟最多推一次。
    this.#publish(node.id, !wasOnline || before !== workKey(this.board.view(node.id, at))
      || node.appVersion !== hello.appVersion || node.capabilities.join() !== hello.capabilities.join(), at);
    if (!wasOnline) {
      this.#options.cameOnline?.({ id: node.id, name: node.name }, at.toISOString());
    }
    if (!wasOnline || (wasStuck && busy === null)) {
      this.#options.cameBack?.({ id: node.id, name: node.name }, at.toISOString());
    }
    return { node: updated, logsWanted: this.logs?.wanted(node.id) ?? null, cancel: this.board.cancelled(node.id) };
  }

  /**
   * AI 取消一个动作：还没领走的直接作废；已经发给设备的，下一次报到时让设备放下（设备交回「取消了」）。
   * 回取消前它的状态；没有这个动作回 null。
   */
  cancel(actionId: string): string | null {
    const row = this.#options.state.nodeActions.byActionId(actionId);
    if (row === undefined) {
      return null;
    }
    if (row.status === 'queued') {
      this.channel.withdraw(row);
    } else if (row.status === 'sent') {
      this.board.cancel(row.nodeId, actionId);
    }
    return row.status;
  }

  /** Inside an outer transaction (the API answer), the event waits for `after`. */
  revoke(nodeId: string, byDeviceId: string, after: (action: () => void) => void): DeviceNode {
    const node = revokeNode(this.#pairing, nodeId, byDeviceId);
    after(() => {
      this.#sink.nodeChanged(nodeId);
      this.channel.wake();
    });
    return node;
  }

  setLimits(
    nodeId: string,
    expectedVersion: number,
    limits: DeviceLimits,
    confirmation: DeviceConfirmation,
    after: (action: () => void) => void,
  ): DeviceNode {
    const node = setNodeLimits(this.#pairing, nodeId, expectedVersion, limits, confirmation);
    after(() => this.#sink.nodeChanged(nodeId));
    return node;
  }
}
