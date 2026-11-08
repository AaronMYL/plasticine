// devices/ put together: the pairing and limits of nodes (pairing.ts) and their actions (actions.ts), over one state
// service, one transport and one clock. app/ attaches a sink so each change reaches the open streams after it commits.

import { NODE_ONLINE_MS } from '../../shared/api/index.ts';
import type {
  NodeActionResultRequest, NodeHelloRequest, NodePairRequest, NodeWireAction,
} from '../../shared/api/index.ts';
import type { DeviceConfirmation, DeviceLimits, DeviceNode, NodePairingCode } from '../../shared/state.ts';
import { MAX_PAGE_SIZE, type StateService } from '../state/index.ts';
import type { AskDesk } from '../attention/index.ts';
import { DeviceActions, IDLE_SINK, type DeviceSink } from './actions.ts';
import { DeviceApprovals } from './approvals.ts';
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
}

export class DeviceService {
  readonly actions: DeviceActions;
  readonly channel: PollingNodeTransport;
  readonly approvals: DeviceApprovals | undefined;
  readonly #pairing: PairingContext;
  readonly #recovered: Set<string>;
  readonly #options: DeviceServiceOptions;
  #sink: DeviceSink = IDLE_SINK;

  constructor(options: DeviceServiceOptions) {
    const now = options.now ?? (() => new Date());
    this.#pairing = { state: options.state, now };
    this.#options = options;
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
      this.#sink.actionRecorded(row);
      this.approvals?.settled(row);
      this.#settleRecovered(row.actionId);
    });
    // iPhone 排队的动作没有工具在等：回执到了照「接续」的路交回（第 102 条）。
    this.actions.onDetached((actionId) => { this.#recovered.add(actionId); });
  }

  attach(sink: DeviceSink): void {
    this.#sink = sink;
    this.actions.attach(sink);
  }

  nextAction(nodeId: string, wait: number, signal: AbortSignal): Promise<NodeWireAction | null> {
    const { state, now } = this.#pairing;
    const node = state.nodes.require(nodeId);
    const at = now();
    const wasOnline = at.getTime() - Date.parse(node.lastSeenAt) <= NODE_ONLINE_MS;
    state.nodes.update(node.id, node.version, { lastSeenAt: at.toISOString() });
    this.#sink.nodeChanged(nodeId);
    if (!wasOnline) {
      this.#options.cameOnline?.({ id: node.id, name: node.name }, at.toISOString());
    }
    return this.channel.next(nodeId, wait, signal);
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
      limits: effectiveLimits(node) }));
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

  hello(node: DeviceNode, hello: NodeHelloRequest): DeviceNode {
    const updated = helloNode(this.#pairing, node, hello);
    this.#sink.nodeChanged(node.id);
    return updated;
  }

  /** Inside an outer transaction (the API answer), the event waits for `after`. */
  revoke(nodeId: string, byDeviceId: string, after: (action: () => void) => void): DeviceNode {
    const node = revokeNode(this.#pairing, nodeId, byDeviceId);
    after(() => { this.#sink.nodeChanged(nodeId); this.channel.wake(); });
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
