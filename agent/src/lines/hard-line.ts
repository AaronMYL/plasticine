// 硬线（shared/act-or-ask.ts 的 HARD_LINES：花钱、以他名义对外答应或发出、删除和撤不回的、权限变化、必须他本人做的）：
// 工具自己声明属不属于硬线；属于的，beforeToolCall 在执行前拦下 → 出一张要你定卡（依据 hard_line）→ 线进 waiting。
// 他同意：只放行这一次，绑定这次调用的工具名 + 参数摘要，用过就作废（改了参数就是另一次调用，要重新问）。
// 他没同意（先不 / 改一下）：把「他没同意」和他说的话作为工具结果交回模型，工具不执行。
// 叫停：卡撤回，这次调用不执行。重启：批准记在库里，重跑这次调用时按批准的状态接着走，不重复出卡。

import type { AgentToolCall, BeforeToolCallResult } from '@earendil-works/pi-agent-core';
import type { Ask } from '../../shared/state.ts';
import type { AskDesk, AskResolver, Changes } from '../attention/index.ts';
import { argsDigest } from '../system/index.ts';
import type { LineApproval, StateService } from '../state/index.ts';
import { clip } from './messages.ts';
import { HARD_LINE_LABELS, type HardLineKind, type KernelTool, type LineScope, type ToolArgs } from './types.ts';
import type { AnswerWaits } from './waits.ts';

export const APPROVAL_PURPOSE = 'line_approval';
const ALLOW = 'allow';
const REVISE = 'revise';
const DENY = 'deny';
// 卡上参数摘要的长度：够他认出是哪一次，不把整封信塞进详情（详情上限 4 000 字）。
const ARGS_PREVIEW_CHARS = 1_500;
// 卡上那一句的长度（《UI 方案》第 6 节：≤ 40 字）。
const QUESTION_CHARS = 40;

const DEFAULT_CONSEQUENCES: Readonly<Record<HardLineKind, string>> = {
  spend: '会花钱，付出去就要不回来。',
  outward: '会以你的名义发出去，对方会收到，撤不回。',
  irreversible: '做了就撤不回。',
  permission: '会改变谁能做什么。',
  in_person: '这件事要你本人做。',
};

export type GateState = Pick<StateService, 'lineApprovals' | 'asks' | 'transaction'>;

export interface GateHost {
  state: GateState;
  desk: AskDesk;
  waits: AnswerWaits;
  /** 线在等他 / 不等了：kernel 改线的状态并推给客户端。 */
  waiting(lineId: string, on: boolean): void;
  now(): Date;
  /** 关服务时中止的等待不撤卡：重启后接着等同一张卡。 */
  shuttingDown(): boolean;
}

function question(tool: KernelTool, args: ToolArgs): string {
  return clip(`要${tool.say(args)}吗？`, QUESTION_CHARS);
}

function detail(tool: KernelTool, args: ToolArgs, kind: HardLineKind): string {
  const consequence = tool.consequence?.(args) ?? DEFAULT_CONSEQUENCES[kind];
  return [
    consequence,
    `硬线：${HARD_LINE_LABELS[kind]}。只放行这一次、这组参数；改了参数要再问你。`,
    `「${tool.name}」的参数：${clip(JSON.stringify(args), ARGS_PREVIEW_CHARS)}`,
  ].join('\n');
}

function declined(approval: LineApproval): string {
  const said = approval.answer === null || approval.answer.trim() === '' ? '' : `他说：${approval.answer.trim()}。`;
  return `他没同意，这一步没有执行。${said}照他的意思改，或者换个做法；同样的事再做要重新问他。`;
}

export class HardLineGate {
  readonly #host: GateHost;

  constructor(host: GateHost) {
    this.#host = host;
  }

  /** beforeToolCall：不是硬线就放行（undefined）；是硬线就等他定。 */
  async check(scope: LineScope, tool: KernelTool, toolCall: AgentToolCall, args: ToolArgs,
    signal: AbortSignal | undefined): Promise<BeforeToolCallResult | undefined> {
    const kind = tool.hardLine(args);
    if (kind === null) {
      return undefined;
    }
    const digest = argsDigest(args);
    let approval = this.#host.state.lineApprovals.forCall(scope.lineId, toolCall.id)
      ?? this.#raise(scope, tool, toolCall, args, kind, digest);
    if (approval.toolName !== toolCall.name || approval.argsDigest !== digest) {
      return { block: true, reason: '这次调用的参数和他批准的那次不一样，没有执行；要做得重新问他。' };
    }
    if (approval.status === 'pending') {
      approval = await this.#await(scope, approval, signal);
    }
    return this.#decide(approval);
  }

  #raise(scope: LineScope, tool: KernelTool, toolCall: AgentToolCall, args: ToolArgs, kind: HardLineKind,
    digest: string): LineApproval {
    const { desk, state } = this.#host;
    return desk.commit((changes) => {
      const ask = desk.raise(changes, {
        kind: 'approve',
        purpose: APPROVAL_PURPOSE,
        question: question(tool, args),
        detail: detail(tool, args, kind),
        options: [
          { id: ALLOW, label: tool.approveLabel?.(args) ?? '同意这一次', recommended: true },
          { id: REVISE, label: '改一下' },
          { id: DENY, label: '先不' },
        ],
        actionId: `line-approval:${scope.lineId}:${toolCall.id}`,
        context: { lineId: scope.lineId, toolCallId: toolCall.id, tool: tool.name, hardLine: kind,
          preview: tool.preview?.(args) ?? null },
        basis: 'hard_line',
        // 后台线他不一定在看：推一条系统通知；主对话里就在眼前，弹框就够了。
        channel: scope.kind === 'background' ? 'interrupt' : 'popup',
      });
      return state.lineApprovals.forCall(scope.lineId, toolCall.id) ?? state.lineApprovals.create({
        lineId: scope.lineId, toolCallId: toolCall.id, toolName: tool.name, argsDigest: digest, hardLine: kind,
        askId: ask.id,
      });
    });
  }

  async #await(scope: LineScope, approval: LineApproval, signal: AbortSignal | undefined): Promise<LineApproval> {
    const { state, waits } = this.#host;
    this.#host.waiting(scope.lineId, true);
    try {
      await waits.wait(approval.askId, signal);
    } catch (error) {
      if (!this.#host.shuttingDown()) {
        this.withdraw(approval);
      }
      throw error;
    } finally {
      this.#host.waiting(scope.lineId, false);
    }
    return state.lineApprovals.get(approval.id) ?? approval;
  }

  #decide(approval: LineApproval): BeforeToolCallResult | undefined {
    const { lineApprovals } = this.#host.state;
    if (approval.status === 'approved') {
      // 一次批准只能用一次：只有从 approved 改成 used 成功的那一处放行。
      if (lineApprovals.setStatus(approval.id, 'used', { from: 'approved' }) !== undefined) {
        return undefined;
      }
    }
    if (approval.status === 'declined') {
      return { block: true, reason: declined(approval) };
    }
    if (approval.status === 'withdrawn') {
      return { block: true, reason: '这张卡撤回了（这一轮被叫停过），这一步没有执行。' };
    }
    return { block: true, reason: '这次批准已经用过了（一次批准只放行一次），这一步没有再执行；要再做得重新问他。' };
  }

  /** 叫停：卡撤回、批准作废。卡已经答了就不动。 */
  withdraw(approval: LineApproval): void {
    const { desk, state } = this.#host;
    desk.commit((changes) => {
      const current = state.lineApprovals.get(approval.id);
      if (current?.status !== 'pending') {
        return;
      }
      state.lineApprovals.setStatus(approval.id, 'withdrawn', { from: 'pending' });
      withdrawAsk(state, changes, approval.askId, this.#host.now().toISOString());
    });
  }

  /** 要你定卡答了：在答卡的同一个事务里记下他同不同意；提交之后由 kernel 放开等着的那一处。 */
  resolver(answered: (ask: Ask) => void): AskResolver {
    const { state } = this.#host;
    return {
      resolve(changes, ask) {
        const approval = state.lineApprovals.byAsk(ask.id);
        if (approval?.status !== 'pending' || ask.answer === null) {
          return;
        }
        const optionId = ask.answer.optionId;
        const text = ask.answer.text;
        const answer = optionId === REVISE ? `想改一下${text === null ? '' : `：${text}`}` : text;
        state.lineApprovals.setStatus(approval.id, optionId === ALLOW ? 'approved' : 'declined',
          { from: 'pending', answer });
        changes.afterCommit(() => answered(ask));
      },
    };
  }
}

/** 撤回一张还开着的卡（叫停时）：只改状态，卡还在库里。 */
export function withdrawAsk(state: Pick<StateService, 'asks'>, changes: Changes, askId: string, at: string): void {
  const ask = state.asks.get(askId);
  if (ask?.status !== 'open') {
    return;
  }
  state.asks.update(ask.id, ask.version, { status: 'withdrawn', withdrawnAt: at });
  changes.ask(ask.id, 'updated');
}
