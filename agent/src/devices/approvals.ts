// 逐次确认的设备动作（第 97、102 条：「要你点」的那一道）：他在已配对的页面点卡授权，这一个动作才
// 发出去。2026-11-05 Harness 重做：没有任务在等了——动作做完（或没做成）以后，结果作为一条消息交回发起它的那条线
// （ask.runId = line:<线>），线接着做；他拒了也告诉那条线。

import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { DeviceActionParamsSchema, DEVICE_KIND_LABELS } from '../../shared/api/index.ts';
import type { Ask, NodeAction } from '../../shared/state.ts';
import { AttentionError, type AskDesk, type AskResolver } from '../attention/index.ts';
import type { StateService } from '../state/index.ts';
import type { ActionRequest, DeviceActions } from './actions.ts';
import { factsOf } from './limits.ts';
import { classifyLane } from './lanes.ts';

const Context = Type.Object({ nodeId: Type.String(), actionId: Type.String(), action: DeviceActionParamsSchema,
  purpose: Type.Optional(Type.Union([Type.String(), Type.Null()])) });

const LINE_RUN_PREFIX = 'line:';
// 交回线上的结果最多这么长：截图、长网页正文在设备动作记录里，线上只要一段能接着做的话。
const RESULT_CHARS = 4_000;

/** 授权过的动作有了结果（或他拒了）：交回哪条线、说什么。 */
export interface ApprovedResult {
  lineId: string;
  text: string;
}

function lineOf(ask: Ask): string | null {
  return ask.runId?.startsWith(LINE_RUN_PREFIX) === true ? ask.runId.slice(LINE_RUN_PREFIX.length) : null;
}

function resultText(row: NodeAction): string {
  const head = `他授权的设备动作「${DEVICE_KIND_LABELS[row.kind]}」（${row.target}）`;
  if (row.status === 'executed') {
    const result = JSON.stringify(row.result ?? null);
    const clipped = Array.from(result).slice(0, RESULT_CHARS).join('');
    return `${head}做完了。结果：${clipped}${clipped.length < result.length ? '……（完整结果在设备动作记录里）' : ''}`;
  }
  if (row.status === 'unknown') {
    return `${head}发出去了，但没拿到回执：结果不明，先核实，不要重发。`;
  }
  if (row.status === 'dry_run') {
    return `${head}在开发期干跑里只记下了，没有真的做。`;
  }
  return `${head}没做成：${row.reason ?? row.status}。`;
}

export class DeviceApprovals {
  readonly #state: StateService;
  readonly #desk: AskDesk;
  readonly #wake: () => void;
  #report: (result: ApprovedResult) => void = () => undefined;
  // 节点回执和启动接续可能各报一次同一个动作：交回线只交一次。
  readonly #reported = new Set<string>();
  readonly resolver: AskResolver;

  constructor(state: StateService, desk: AskDesk, actions: DeviceActions, wake: () => void) {
    this.#state = state;
    this.#desk = desk;
    this.#wake = wake;
    this.resolver = {
      resolve: (changes, ask, answerer) => {
        const lineId = lineOf(ask);
        if (ask.answer?.optionId !== 'allow') {
          if (lineId !== null) {
            changes.afterCommit(() => this.#report({ lineId, text: '他没有授权这一次设备动作，动作没有发出：'
              + '照这个决定接着做，别绕过去。' }));
          }
          return;
        }
        const confirmation = answerer.confirmation;
        if (confirmation === undefined || confirmation.deviceId !== answerer.deviceId) {
          throw new AttentionError('invalid_answer', '请在已配对的页面确认这一次授权。');
        }
        const context = ask.context;
        if (!Value.Check(Context, context)) {
          throw new AttentionError('invalid_answer', '动作资料不完整，请重新发起。');
        }
        const row = actions.enqueueApproved({ ...context, origin: 'brain', taskId: null, runId: ask.runId },
          confirmation);
        changes.afterCommit(() => {
          actions.publish(row);
          this.#wake();
          this.settled(row);
        });
      },
    };
  }

  /** 结果交回线（assemble 接到新内核上）。 */
  onResult(report: (result: ApprovedResult) => void): void {
    this.#report = report;
  }

  request(request: ActionRequest): Ask {
    const node = this.#state.nodes.require(request.nodeId);
    const lane = classifyLane(request.action, request.purpose ?? '');
    return this.#desk.commit((changes) => this.#desk.raise(changes, { kind: 'approve', purpose: 'device_action',
      question: `授权「${DEVICE_KIND_LABELS[request.action.kind]}」这一次？`,
      detail: [`节点：${node.name}`, `目标：${factsOf(request.action).target}`,
        ...(request.purpose === undefined || request.purpose === null ? [] : [`用途：${request.purpose}`]),
        ...(lane.lane === 'allow' ? [] : [`为什么要你点：${lane.reason}`]),
        '只授权这一个动作，不改变设备上限。'].join('\n'),
      options: [{ id: 'allow', label: '授权这一次' }, { id: 'deny', label: '不执行' }],
      actionId: `device-approval:${request.actionId}`, taskId: null, runId: request.runId ?? null,
      context: { nodeId: request.nodeId, actionId: request.actionId, action: request.action,
        purpose: request.purpose ?? null },
    }));
  }

  /** 授权过的动作有了结果：交回发起它的线（只交一次：节点回执只到一次，重启后的补交由 service 的接续管）。 */
  settled(row: NodeAction): void {
    if (row.status === 'queued' || row.status === 'sent') {
      return;
    }
    const ask = this.#state.asks.byActionId(`device-approval:${row.actionId}`);
    if (ask?.status !== 'answered' || ask.answer?.optionId !== 'allow') {
      return;
    }
    const lineId = lineOf(ask);
    if (lineId !== null && !this.#reported.has(row.actionId)) {
      this.#reported.add(row.actionId);
      this.#report({ lineId, text: resultText(row) });
    }
  }
}
