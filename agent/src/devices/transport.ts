// 云端到节点的那一段（《应用架构方案》第 10 节）：节点持 Bearer 凭证主动长轮询，动作从持久化队列取走。
// 发不出去分两种：确定没送到（节点不在线、没连上）——动作没发生，云端记「被拒 · 节点不可用」；送出去之后断了——说不清
// 做没做，记「结果不明」，同一个动作标识不再发，等核实。

import { Value } from 'typebox/value';
import {
  DEVICE_RESULT_SCHEMAS, NodeActionEnvelopeSchema, NodeActionResultRequestSchema,
  type NodeActionEnvelope, type NodeActionReport, type NodeActionResultRequest, type NodeWireAction,
} from '../../shared/api/index.ts';
import type { NodeAction, NodeActionPatch } from '../../shared/state.ts';
import { argsDigest } from '../system/index.ts';
import type { StateService } from '../state/index.ts';
import { DeviceError } from './errors.ts';

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
        if (row === undefined) { finish(new TransportError('动作没有落盘。', false)); return; }
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
      else { check(); this.wake(); }
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
    // 失败的种类（截图过期这类）跟着结果存下，工具据此自动重截（第 102 条）。
    const result = body.errorCode === undefined ? body.result ?? null : { ...body.result, errorCode: body.errorCode };
    this.#update(row, { status: body.status, result,
      reason: body.error ?? (body.status === 'refused' ? '设备拒绝了这一步。' : null),
      refusalLayer: body.status === 'refused' ? 'device' : null,
      executedAt: this.#now().toISOString(), reportDigest: digest });
    for (const check of [...this.#reports]) { check(); }
    this.#schedule();
  }

  sweep(): void {
    if (this.#stopped) { return; }
    const now = this.#now().getTime();
    for (const row of this.#state.nodeActions.pending()) {
      if (row.deadline !== null && Date.parse(row.deadline) <= now) { this.#expire(row); }
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
    if (!Value.Check(NodeActionEnvelopeSchema, row.envelope)) {
      this.#update(row, { status: 'refused', refusalLayer: 'params', reason: '动作参数无法恢复，请重新发起。' });
      return this.#take(nodeId);
    }
    const { kind, ...params } = row.envelope.action;
    this.#update(row, { status: 'sent', deliveredAt: this.#now().toISOString() });
    return { id: row.actionId, kind, params, deadline: row.envelope.expiresAt };
  }

  #expire(row: NodeAction): void {
    this.#update(row, row.status === 'queued'
      ? { status: 'refused', refusalLayer: 'node', reason: UNAVAILABLE }
      : { status: 'unknown', reason: UNKNOWN });
    for (const check of [...this.#reports]) { check(); }
  }

  #schedule(): void {
    clearTimeout(this.#timer);
    const deadlines = this.#state.nodeActions.pending().flatMap((row) =>
      row.deadline === null ? [] : [Date.parse(row.deadline)]);
    if (deadlines.length === 0) { return; }
    this.#timer = setTimeout(() => this.sweep(), Math.max(1, Math.min(...deadlines) - this.#now().getTime()));
    this.#timer.unref();
  }

  #update(row: NodeAction, patch: NodeActionPatch): void {
    const updated = this.#state.nodeActions.update(row.id, row.version, patch);
    this.#changed(updated);
  }
}
