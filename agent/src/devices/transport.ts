import { Value } from 'typebox/value';
import {
  DEVICE_RESULT_SCHEMAS, NODE_ONLINE_MS, NodeActionResultRequestSchema,
  type NodeActionEnvelope, type NodeActionReport, type NodeActionResultRequest, type NodeWireAction,
} from '../../shared/api/index.ts';
import type { NodeAction, NodeActionPatch } from '../../shared/state.ts';
import { argsDigest } from '../system/index.ts';
import type { StateService } from '../state/index.ts';
import { DeviceError } from './errors.ts';
import { dispatchEnvelope } from './action-id.ts';

export class TransportError extends Error {
  /** True when the envelope may have reached the node: the action may have happened. */
  readonly delivered: boolean;
  readonly stopping: boolean;

  constructor(message: string, delivered: boolean, stopping = false) {
    super(message);
    this.name = 'TransportError';
    this.delivered = delivered;
    this.stopping = stopping;
  }
}

export interface NodeTransport {
  /** This transport persists the queued → sent → result transitions itself. */
  readonly managesDelivery?: boolean;
  /** Sends one action and waits for the node's report; rejects with TransportError when it cannot tell. */
  send(envelope: NodeActionEnvelope, signal: AbortSignal): Promise<NodeActionReport>;
}

/** Explicit disconnected adapter for tests and callers that disable delivery. */
export const UNCONNECTED_TRANSPORT: NodeTransport = {
  send() {
    return Promise.reject(new TransportError('节点没有接上云端。', false));
  },
};

type ChannelState = Pick<StateService, 'nodes' | 'nodeActions' | 'transaction'>;
const UNKNOWN = '动作已发出，但没有收到结果；结果不明，请先核实，不再发送。';
const UNAVAILABLE = '节点不可用：期限内没有取走动作，这次没有执行。请检查节点连接后再试。';
const MISSING_RECEIPT_MS = 2 * 60_000;
const MISSING_RECEIPT = '设备没接这一步：等待已超过两分钟，同设备后续动作已有回执，'
  + '但这一步没有执行回执，结果仍待核实；不再重发，请检查设备动作记录。';

const NOT_DOING = '设备说它没在做这一步，也没交结果：结果不明，先核实（可以看 device_logs），不要直接再发。';
const NOT_DOING_AFTER_MS = 15_000;
const NOT_DOING_HELLOS = 2;
const WITHDRAWN = '取消了：还没发给设备就收回了，这一步没有做。';
const WENT_AWAY = '设备领走这一步以后 90 秒没再报到（可能关了、睡了或卡死了）：结果不明，先核实，不要直接再发；'
  + '设备回来后这条任务会接着做。';

/** Durable outbox: only taking an action changes queued to sent, before the HTTP response is written. */
export class PollingNodeTransport implements NodeTransport {
  readonly managesDelivery = true;
  readonly #state: ChannelState;
  readonly #now: () => Date;
  readonly #polls = new Set<() => void>();
  readonly #reports = new Set<() => void>();
  #timer: ReturnType<typeof setTimeout> | undefined;
  #stopped = false;
  #changed: (row: NodeAction) => void = () => undefined;
  readonly #notDoing = new Map<string, number>();

  constructor(state: ChannelState, now: () => Date) {
    this.#state = state;
    this.#now = now;
    for (const row of state.nodeActions.pending()) {
      if (row.status === 'sent') {
        this.#update(row, { status: 'unknown', reason: UNKNOWN });
      }
    }
    this.sweep();
  }

  attach(changed: (row: NodeAction) => void): void {
    this.#changed = changed;
  }

  /** Also called after a signed approval commits its queued action. */
  wake(): void {
    if (this.#stopped) { return; }
    this.sweep();
    queueMicrotask(() => {
      for (const poll of [...this.#polls]) { poll(); }
    });
  }

  send(envelope: NodeActionEnvelope, signal: AbortSignal): Promise<NodeActionReport> {
    return new Promise((resolve, reject) => {
      const finish = (error?: TransportError, report?: NodeActionReport): void => {
        this.#reports.delete(check);
        signal.removeEventListener('abort', abort);
        if (error !== undefined) { reject(error); }
        else if (report !== undefined) { resolve(report); }
      };
      const check = (): void => {
        const row = this.#state.nodeActions.byActionId(envelope.actionId);
        if (row === undefined) {
          finish(new TransportError('动作没有落盘。', false));
          return;
        }
        if (this.#stopped) {
          finish(new TransportError('服务正在停止，未发动作保留到下次启动。', row.status !== 'queued', true));
        } else if (row.status === 'unknown') {
          finish(new TransportError(UNKNOWN, true));
        } else if (row.status === 'refused' && row.deliveredAt === null) {
          finish(new TransportError(UNAVAILABLE, false));
        } else if (row.status === 'executed' || row.status === 'failed' || row.status === 'refused') {
          finish(undefined, { actionId: row.actionId, status: row.status,
            executedAt: row.executedAt ?? this.#now().toISOString(), result: row.result,
            ...(row.reason === null ? {} : { error: row.reason }),
            ...(row.status !== 'refused' ? {} : { refusal: { layer: 'device', reason: row.reason ?? '设备拒绝。' } }),
          });
        }
      };
      const abort = (): void => {
        const row = this.#state.nodeActions.byActionId(envelope.actionId);
        if (row?.status === 'queued' || row?.status === 'sent') {
          this.#expire(row);
        }
        check();
      };
      this.#reports.add(check);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) { abort(); }
      else {
        check();
        this.wake();
      }
    });
  }

  next(nodeId: string, wait: number, signal: AbortSignal): Promise<NodeWireAction | null> {
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (action: NodeWireAction | null, error?: unknown): void => {
        clearTimeout(timer);
        this.#polls.delete(check);
        signal.removeEventListener('abort', abort);
        if (error !== undefined) { reject(error); } else { resolve(action); }
      };
      const abort = (): void => finish(null);
      const check = (): void => {
        try {
          const node = this.#state.nodes.get(nodeId);
          if (this.#stopped || signal.aborted || node === undefined || node.revokedAt !== null) {
            finish(null);
            return;
          }
          const action = this.#take(nodeId);
          if (action !== null) { finish(action); }
        } catch (error) { finish(null, error); }
      };
      this.#polls.add(check);
      signal.addEventListener('abort', abort, { once: true });
      timer = setTimeout(abort, wait * 1000);
      check();
    });
  }

  report(nodeId: string, actionId: string, body: NodeActionResultRequest): void {
    if (!Value.Check(NodeActionResultRequestSchema, body)) {
      throw new DeviceError('invalid_input', '节点结果格式不对，请按协议重新上报。');
    }
    const row = this.#state.nodeActions.byActionId(actionId);
    if (row === undefined || row.nodeId !== nodeId) {
      throw new DeviceError('not_found', '没有这台节点的这个动作。');
    }
    const digest = argsDigest(body);
    if (row.reportDigest !== null) {
      if (row.reportDigest !== digest) {
        throw new DeviceError('action_conflict', '这个动作已经报过不同的结果，请核对原结果。');
      }
      return;
    }
    if (row.status !== 'sent' && row.status !== 'unknown' && row.deliveredAt === null) {
      throw new DeviceError('action_conflict', '这个动作没有发给节点，不能上报结果。');
    }
    if (body.status === 'executed' && body.result !== undefined
      && !Value.Check(DEVICE_RESULT_SCHEMAS[row.kind], body.result)) {
      throw new DeviceError('invalid_input', '动作结果字段不符合该动作的格式，请按协议重新上报。');
    }
    const result = body.errorCode === undefined ? body.result ?? null : { ...body.result, errorCode: body.errorCode,
      ...(body.timedOut === undefined ? {} : { timedOut: body.timedOut }) };
    this.#update(row, { status: body.status, result,
      reason: body.error ?? (body.status === 'refused' ? '设备拒绝了这一步。' : null),
      refusalLayer: body.status === 'refused' ? 'device' : null,
      executedAt: this.#now().toISOString(), reportDigest: digest });
    for (const check of [...this.#reports]) { check(); }
    this.sweep();
  }

  heard(nodeId: string, busy: string | null): void {
    const now = this.#now().getTime();
    for (const row of this.#state.nodeActions.pending()) {
      if (row.nodeId !== nodeId || row.status !== 'sent' || row.actionId === busy
        || now - Date.parse(row.deliveredAt ?? row.requestedAt) < NOT_DOING_AFTER_MS) {
        continue;
      }
      const times = (this.#notDoing.get(row.actionId) ?? 0) + 1;
      this.#notDoing.set(row.actionId, times);
      if (times >= NOT_DOING_HELLOS) {
        this.#notDoing.delete(row.actionId);
        this.#update(row, { status: 'unknown', reason: NOT_DOING });
        for (const check of [...this.#reports]) { check(); }
      }
    }
  }

  withdraw(row: NodeAction): void {
    if (row.status !== 'queued') { return; }
    this.#update(row, { status: 'refused', refusalLayer: 'node', reason: WITHDRAWN });
    for (const check of [...this.#reports]) { check(); }
  }

  sweep(): void {
    if (this.#stopped) { return; }
    const now = this.#now().getTime();
    for (const row of this.#state.nodeActions.pending()) {
      if (row.deadline !== null && Date.parse(row.deadline) <= now) { this.#expire(row); }
      else if (row.status === 'sent' && this.#silentSince(row.nodeId) + NODE_ONLINE_MS <= now) {
        this.#update(row, { status: 'unknown', reason: WENT_AWAY });
        for (const check of [...this.#reports]) { check(); }
      }
    }
    for (const row of this.#state.nodeActions.unreportedWithLaterReceipt()) {
      const sentAt = Date.parse(row.deliveredAt ?? row.requestedAt);
      if (now - sentAt >= MISSING_RECEIPT_MS && row.reason !== MISSING_RECEIPT) {
        this.#update(row, { status: 'unknown', reason: MISSING_RECEIPT });
        for (const check of [...this.#reports]) { check(); }
      }
    }
    this.#schedule();
  }

  stop(): void {
    this.#stopped = true;
    clearTimeout(this.#timer);
    for (const poll of [...this.#polls]) { poll(); }
    for (const check of [...this.#reports]) { check(); }
  }

  #take(nodeId: string): NodeWireAction | null {
    this.sweep();
    const row = this.#state.nodeActions.pending().find((item) => item.nodeId === nodeId && item.status === 'queued');
    if (row === undefined) { return null; }
    const envelope = dispatchEnvelope(row.envelope);
    if (envelope === null) {
      this.#update(row, { status: 'refused', refusalLayer: 'params', reason: '动作参数无法恢复，请重新发起。' });
      return this.#take(nodeId);
    }
    const { kind, ...params } = envelope.action;
    this.#update(row, { status: 'sent', deliveredAt: this.#now().toISOString() });
    return { id: row.actionId, kind, params, deadline: envelope.expiresAt };
  }

  #expire(row: NodeAction): void {
    this.#update(row, row.status === 'queued'
      ? { status: 'refused', refusalLayer: 'node', reason: UNAVAILABLE }
      : { status: 'unknown', reason: UNKNOWN });
    for (const check of [...this.#reports]) { check(); }
  }

  #schedule(): void {
    clearTimeout(this.#timer);
    const deadlines = this.#state.nodeActions.pending().flatMap((row) => [
      ...(row.deadline === null ? [] : [Date.parse(row.deadline)]),
      ...(row.status === 'sent' ? [this.#silentSince(row.nodeId) + NODE_ONLINE_MS] : []),
    ]);
    for (const row of this.#state.nodeActions.unreportedWithLaterReceipt()) {
      if (row.reason !== MISSING_RECEIPT) {
        deadlines.push(Date.parse(row.deliveredAt ?? row.requestedAt) + MISSING_RECEIPT_MS);
      }
    }
    if (deadlines.length === 0) { return; }
    this.#timer = setTimeout(() => this.sweep(), Math.max(1, Math.min(...deadlines) - this.#now().getTime()));
    this.#timer.unref();
  }

  #silentSince(nodeId: string): number {
    const node = this.#state.nodes.get(nodeId);
    return node === undefined ? this.#now().getTime() : Date.parse(node.lastSeenAt);
  }

  #update(row: NodeAction, patch: NodeActionPatch): void {
    const updated = this.#state.nodeActions.update(row.id, row.version, patch);
    this.#changed(updated);
  }
}
