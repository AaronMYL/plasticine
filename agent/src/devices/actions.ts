// 设备动作（《应用架构方案》第 4、5、8 节）：一个动作一个 action_id，先落盘再发（harness 5.3）。同一个标识再来：做过的返回
// 原来的结果、发出去还没回执的算结果不明（不再发，先核实）、被拒或没做成的按现在的上限重新检查（照 execution/receipts.ts：
// 没产生效果的同一标识可以再做）。检查不过一律当场拒，不排队；拒了记一行、记遥测、推给界面，原因那一句也回给脑。

import { randomUUID } from 'node:crypto';
import { Value } from 'typebox/value';
import { NODE_ONLINE_MS, NODE_PROTOCOL_VERSION, NodeActionReportSchema,
  type DeviceActionParams, type NodeActionEnvelope } from '../../shared/api/index.ts';
import type {
  DeviceConfirmation,
  DeviceNode,
  NodeAction,
  NodeActionPatch,
  NodeActionStatus,
  NodeRefusalLayer,
} from '../../shared/state.ts';
import { argsDigest } from '../system/index.ts';
import { errorCategory, safeLog } from '../shared-log.ts';
import { MAX_PAGE_SIZE, type StateService } from '../state/index.ts';
import { DeviceError } from './errors.ts';
import { checkAction, factsOf, type Refusal } from './limits.ts';
import { effectiveLimits } from './pairing.ts';
import { holdFor, queuesUntilOnline, type DeviceHold } from './holds.ts';
import { classifyLane } from './lanes.ts';
import { submitHoldForRun, submitRefusal, type SubmitHold } from './page-submits.ts';
import { choosePlace, type PlaceChoice } from './route.ts';
import { TransportError, type NodeTransport } from './transport.ts';
import { dispatchEnvelope, normalizeActionRequest } from './action-id.ts';

export type ActionState = Pick<StateService, 'nodes' | 'nodeActions' | 'asks' | 'transaction' | 'lines'
  | 'schedules' | 'scheduleSends'>;

export interface DeviceSink {
  nodeChanged(nodeId: string): void;
  actionRecorded(action: NodeAction): void;
}

export const IDLE_SINK: DeviceSink = { nodeChanged: () => undefined, actionRecorded: () => undefined };

export interface ActionRequest {
  actionId: string;
  /** 本地追溯用的原工具编号；设备只收到规范化后的 actionId。 */
  originalActionId?: string;
  nodeId: string;
  action: DeviceActionParams;
  origin: NodeAction['origin'];
  taskId?: string | null;
  runId?: string | null;
  /** Someone is at the device (only 点击输入 with unattendedInput off asks). Unknown counts as nobody. */
  attended?: boolean;
  /** 第 102 条：模型写明的用途；判道（lanes.ts）按它和参数。系统和用户发起的动作可以没有。 */
  purpose?: string | null;
  signal?: AbortSignal;
}

export interface ActionOutcome {
  actionId: string;
  status: NodeActionStatus;
  refusalLayer: NodeRefusalLayer | null;
  /** One sentence for the brain and the user when it was refused or did not happen. */
  reason: string | null;
  result: unknown;
  /** An earlier outcome of the same action id, returned without doing anything. */
  reused: boolean;
  /** iPhone：动作排进了队列，下次打开 App 时执行；没有等它，回执到了才算做了。 */
  detached?: boolean;
}

// 「离线规则：派发时写明期限」：一个动作发出后 10 分钟内没开始就不开始（同执行资格的默认租约）。
export const ACTION_TTL_MS = 10 * 60 * 1000;
// 第 102 条：iPhone 的动作是「下次打开 App 时执行」，期限默认 24 小时。
export const IOS_ACTION_TTL_MS = 24 * 60 * 60 * 1000;
const QUEUED_REASON = '已排队：下次打开 iPhone 上的 Plasticine 时执行（24 小时内）；还没有做，回执到了才算做了。';
const MAC_QUEUED_REASON = (name: string): string => `「${name}」现在不在线，已排队：Mac 上线后执行（24 小时内）；`
  + '还没有做，回执到了才算做了。';
const HOUR_MS = 60 * 60 * 1000;
// What a result may take in the record (the tool result limit, shared/tools.ts DEFAULT_MAX_RESULT_CHARS).
const RESULT_MAX_CHARS = 10_000;
const UNKNOWN_REASON = '这一步发出去之后没有拿到回执，说不清做没做；同一个动作不再发，先核实。';

function storedResult(result: unknown): unknown {
  if (result === undefined) {
    return null;
  }
  const text = JSON.stringify(result);
  if (text.length <= RESULT_MAX_CHARS) {
    return result;
  }
  return { truncated: true, preview: text.slice(0, RESULT_MAX_CHARS) };
}

function outcomeOf(row: NodeAction, reused: boolean): ActionOutcome {
  const unknown = row.status === 'sent' || row.status === 'unknown';
  return {
    actionId: row.actionId,
    status: row.status === 'sent' ? 'unknown' : row.status,
    refusalLayer: row.refusalLayer,
    reason: unknown ? (row.reason ?? UNKNOWN_REASON) : row.reason,
    result: row.result,
    reused,
  };
}

/** Rows whose action did not take effect: the same action id may be checked and tried again. */
function mayRunAgain(row: NodeAction, dryRun: boolean): boolean {
  return row.deliveredAt === null && row.reportDigest === null
    && (row.status === 'refused' || row.status === 'failed' || (row.status === 'dry_run' && !dryRun));
}

export interface DeviceActionsOptions {
  state: ActionState;
  transport: NodeTransport;
  now: () => Date;
  /** Development dry run of device actions (decisions 8 and 68): recorded, never sent. */
  dryRun: boolean;
}

export class DeviceActions {
  readonly #state: ActionState;
  readonly #transport: NodeTransport;
  readonly #now: () => Date;
  readonly #dryRun: boolean;
  #sink: DeviceSink = IDLE_SINK;
  #detached: (actionId: string) => void = () => undefined;

  constructor(options: DeviceActionsOptions) {
    this.#state = options.state;
    this.#transport = options.transport;
    this.#now = options.now;
    this.#dryRun = options.dryRun;
  }

  attach(sink: DeviceSink): void {
    this.#sink = sink;
  }

  /** A completed or in-flight action is read back, even if today's limits or heartbeat changed. */
  replayable(request: ActionRequest): boolean {
    const row = this.#existing(normalizeActionRequest(request));
    return row !== undefined && row.nodeId === request.nodeId && row.paramsDigest === argsDigest(request.action)
      && !this.#mayRunAgain(row);
  }

  #mayRunAgain(row: NodeAction): boolean {
    const approval = this.#state.asks.byActionId(`device-approval:${row.actionId}`);
    return mayRunAgain(row, this.#dryRun) && approval?.status !== 'answered';
  }

  publish(row: NodeAction): void { this.#sink.actionRecorded(row); }

  /**
   * The checks that do not depend on the action's history (the brain's permission gate asks before the call has an
   * action id): everything but the hourly count. The count waits for perform, which first answers a replay of an
   * action already done with its result — a replay must never be refused as one action too many.
   */
  screen(request: Omit<ActionRequest, 'actionId'>): Refusal | null {
    return this.#refusal(request, this.#state.nodes.get(request.nodeId), false);
  }

  /** A refusal found by `screen`, recorded under an id of its own: the call never got an action id. */
  recordRefusal(request: Omit<ActionRequest, 'actionId'>, refusal: Refusal): NodeAction {
    const patch = { status: 'refused' as const, refusalLayer: refusal.layer, reason: refusal.reason };
    return this.#write(undefined, { ...request, actionId: `refused:${randomUUID()}` }, patch);
  }

  async perform(request: ActionRequest): Promise<ActionOutcome> {
    request = normalizeActionRequest(request);
    const prepared = this.#prepare(request);
    if (!prepared.send) { return outcomeOf(prepared.row, prepared.reused); }
    const node = this.#state.nodes.require(request.nodeId);
    if (queuesUntilOnline(node, request.action.kind, this.#now()) && prepared.row.status === 'queued') {
      // 不占着工具等 24 小时：回执由长轮询通道收下后再结（service.ts 的接续）。
      this.#detached(prepared.row.actionId);
      const reason = node.platform === 'ios' ? QUEUED_REASON : MAC_QUEUED_REASON(node.name);
      return { ...outcomeOf(prepared.row, false), status: 'queued', reason, detached: true };
    }
    return outcomeOf(await this.#send(prepared.row, node, request), false);
  }

  /** Called with the action id of every iPhone action left in the queue without a caller waiting for it. */
  onDetached(listener: (actionId: string) => void): void {
    this.#detached = listener;
  }

  /** 关死的动作（付款、下单、转账）先于一切等待和授权直接拒；只有本人放开过 payments 的节点才转「要你点」。 */
  closed(request: Omit<ActionRequest, 'actionId'>): Refusal | null {
    const node = this.#state.nodes.get(request.nodeId);
    const lane = classifyLane(request.action, request.purpose ?? '');
    if (lane.lane !== 'deny' || node !== undefined && effectiveLimits(node).payments === 'confirm_each') {
      return null;
    }
    return { layer: 'class', reason: lane.reason };
  }

  /** 第 3 批：tab_act 带着 submitAsk 时核对他在卡上选了提交（page-submits.ts）；平时是 null。 */
  submitRefusal(request: Omit<ActionRequest, 'actionId'>): Refusal | null {
    return submitRefusal(this.#state, request);
  }

  /** 新内核：这条线在这个标签上最近一次被拦下的提交，没有是 null。 */
  submitHoldForRun(runId: string, nodeId: string, tabId: string): SubmitHold | null {
    return submitHoldForRun(this.#state, runId, nodeId, tabId);
  }

  /** 第 3 批：节点不在时这一步该在哪做（route.ts，他的原话：不用登录的云端先做、登录不上的等 Mac、iPhone 能做的也行）。 */
  route(request: Omit<ActionRequest, 'actionId'>, needsLogin: boolean): PlaceChoice {
    return choosePlace(request.action.kind, needsLogin, this.#state.nodes.list({ limit: MAX_PAGE_SIZE }),
      this.#now());
  }

  /** 第 102 条：该等着或该问用户的情况（holds.ts），在发出之前看。 */
  hold(request: Omit<ActionRequest, 'actionId'>): DeviceHold | null {
    return holdFor(this.#state, this.#state.nodes.get(request.nodeId), request.action.kind,
      request.runId ?? null, this.#now());
  }

  nodeName(nodeId: string): string {
    return this.#state.nodes.get(nodeId)?.name ?? nodeId;
  }

  /** Called only by the user's card confirmation; commit the queue together with that answer. */
  enqueueApproved(request: ActionRequest, confirmation: DeviceConfirmation): NodeAction {
    if (!confirmation.deviceId || !Number.isFinite(Date.parse(confirmation.confirmedAt))) {
      throw new DeviceError('invalid_input', '动作缺少本人确认，请在已配对的页面确认。');
    }
    return this.#prepare(normalizeActionRequest(request), confirmation).row;
  }

  #existing(request: ActionRequest): NodeAction | undefined {
    const legacy = request.originalActionId === undefined ? undefined
      : this.#state.nodeActions.byActionId(request.originalActionId);
    // 历史记录可能已经执行或仍未取得回执；换编号不能把同一步变成新动作重发。
    if (legacy !== undefined && !this.#mayRunAgain(legacy)) { return legacy; }
    return this.#state.nodeActions.byActionId(request.actionId);
  }

  #prepare(request: ActionRequest,
    confirmation?: DeviceConfirmation): { row: NodeAction; send: boolean; reused: boolean } {
    const digest = argsDigest(request.action);
    const existing = this.#existing(request);
    if (existing !== undefined) {
      if (existing.paramsDigest !== digest || existing.nodeId !== request.nodeId) {
        const message = `动作标识 ${request.actionId} 已经用在另一个设备动作上了，这次没有执行。`;
        throw new DeviceError('action_conflict', message, { field: 'actionId' });
      }
      if (!this.#mayRunAgain(existing)) {
        return { row: existing, send: false, reused: true };
      }
    }
    const node = this.#state.nodes.get(request.nodeId);
    const refusal = this.#refusal(request, node, true, confirmation !== undefined);
    if (refusal !== null || node === undefined) {
      const layer = refusal?.layer ?? 'node';
      const reason = refusal?.reason ?? '没有这台节点。';
      const row = this.#write(existing, request, { status: 'refused', refusalLayer: layer, reason },
        undefined, confirmation === undefined);
      return { row, send: false, reused: false };
    }
    if (this.#dryRun) {
      const reason = '干跑：开发期设备动作只记录，不发给设备（第 68 条）。';
      return { row: this.#write(existing, request, { status: 'dry_run', refusalLayer: null, reason },
        undefined, confirmation === undefined),
        send: false, reused: false };
    }
    const issuedAt = this.#now();
    const ttl = queuesUntilOnline(node, request.action.kind, issuedAt) ? IOS_ACTION_TTL_MS : ACTION_TTL_MS;
    const envelope: NodeActionEnvelope = {
      protocolVersion: NODE_PROTOCOL_VERSION, actionId: request.actionId, nodeId: node.id,
      issuedAt: issuedAt.toISOString(), expiresAt: new Date(issuedAt.getTime() + ttl).toISOString(),
      limitsVersion: node.limitsVersion, action: request.action,
    };
    const row = this.#write(existing, request, {
      status: confirmation !== undefined || this.#transport.managesDelivery === true ? 'queued' : 'sent',
      refusalLayer: null, reason: null,
    }, envelope, confirmation === undefined);
    return { row, send: true, reused: false };
  }

  #refusal(request: Omit<ActionRequest, 'actionId'>, node: DeviceNode | undefined,
    counting: boolean, confirmed = false): Refusal | null {
    if (node === undefined) {
      return { layer: 'node', reason: '没有这台节点；这次没有发出。' };
    }
    if (node.revokedAt !== null) {
      return { layer: 'node', reason: `节点「${node.name}」已经撤销了，不再接收动作；这次没有发出。` };
    }
    if (!node.capabilities.includes(request.action.kind)) {
      return { layer: 'node', reason: `节点「${node.name}」没有报这项能力；这次没有发出。` };
    }
    if (!queuesUntilOnline(node, request.action.kind, this.#now())
      && this.#now().getTime() - Date.parse(node.lastSeenAt) > NODE_ONLINE_MS) {
      return { layer: 'node', reason: `节点「${node.name}」已离线，请先连接节点再试。` };
    }
    const limits = effectiveLimits(node);
    const lane = classifyLane(request.action, request.purpose ?? '');
    if (lane.lane === 'deny' && limits.payments !== 'confirm_each') {
      return { layer: 'class', reason: lane.reason };
    }
    if (lane.lane !== 'allow' && !confirmed) {
      return { layer: 'confirm', reason: lane.reason };
    }
    const since = new Date(this.#now().getTime() - HOUR_MS).toISOString();
    return checkAction({
      action: request.action,
      limits,
      usedThisHour: (actionClass) => (counting ? this.#state.nodeActions.countSince(node.id, actionClass, since) : 0),
      attended: request.attended ?? false,
      confirmed,
    });
  }

  async #send(row: NodeAction, node: DeviceNode, request: ActionRequest): Promise<NodeAction> {
    const envelope = dispatchEnvelope(row.envelope);
    if (envelope === null) {
      return this.#finish(row, { status: 'refused', refusalLayer: 'params', reason: '动作参数无法恢复，请重新发起。' });
    }
    try {
      const report: unknown = await this.#transport.send(envelope, request.signal ?? new AbortController().signal);
      if (!Value.Check(NodeActionReportSchema, report) || report.actionId !== row.actionId) {
        return this.#finish(row, { status: 'unknown', reason: '节点的回执格式不对，说不清做没做；先核实。' });
      }
      const at = report.executedAt;
      if (report.status === 'refused') {
        const reason = report.refusal?.reason ?? '设备按它自己的上限拒了这一步。';
        return this.#finish(row, { status: 'refused', refusalLayer: 'device', reason, deliveredAt: at });
      }
      const patch: NodeActionPatch = {
        status: report.status,
        result: storedResult(report.result),
        reason: report.status === 'failed' ? (report.error ?? '设备说这一步没做成。') : null,
        deliveredAt: at,
        executedAt: at,
      };
      return this.#finish(row, patch);
    } catch (error) {
      if (error instanceof TransportError && error.stopping) {
        return this.#state.nodeActions.get(row.id) ?? row;
      }
      if (error instanceof TransportError && !error.delivered) {
        const reason = `节点「${node.name}」现在连不上；这次没有发出。请检查节点连接后再试。`;
        return this.#finish(row, { status: 'refused', refusalLayer: 'node', reason });
      }
      // Sent, then lost (a timeout, a broken connection, a cancel): it may have happened.
      safeLog('error', 'device_action_unknown', { objectId: row.actionId, category: errorCategory(error) });
      return this.#finish(row, { status: 'unknown', reason: UNKNOWN_REASON });
    }
  }

  #write(
    existing: NodeAction | undefined,
    request: ActionRequest,
    patch: { status: NodeActionStatus; refusalLayer: NodeRefusalLayer | null; reason: string | null },
    envelope?: NodeActionEnvelope,
    publish = true,
  ): NodeAction {
    const state = this.#state;
    const at = this.#now().toISOString();
    const facts = factsOf(request.action);
    const stored = envelope === undefined ? null : { ...envelope,
      ...(request.originalActionId === undefined ? {} : { originalActionId: request.originalActionId }) };
    const row = state.transaction(() => {
      const written = existing === undefined
        ? state.nodeActions.record({
          actionId: request.actionId,
          nodeId: request.nodeId,
          kind: request.action.kind,
          actionClass: facts.actionClass,
          target: facts.target,
          paramsDigest: argsDigest(request.action),
          origin: request.origin,
          requestedAt: at,
          taskId: request.taskId ?? null,
          runId: request.runId ?? null,
          envelope: stored,
          deadline: envelope?.expiresAt ?? null,
          purpose: request.purpose ?? null,
          ...patch,
        })
        : state.nodeActions.update(existing.id, existing.version, { ...patch, result: null, executedAt: null,
          deliveredAt: null, reportDigest: null, envelope: stored, deadline: envelope?.expiresAt ?? null });
      return written;
    });
    if (publish) { this.#sink.actionRecorded(row); }
    return row;
  }

  #finish(row: NodeAction, patch: NodeActionPatch): NodeAction {
    const current = this.#state.nodeActions.get(row.id) ?? row;
    if (current.status !== 'queued' && current.status !== 'sent') { return current; }
    const at = this.#now().toISOString();
    const updated = this.#state.nodeActions.update(current.id, current.version, patch);
    this.#sink.actionRecorded(updated);
    return updated;
  }
}
