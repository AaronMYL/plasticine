import type { AgentToolCall, AgentToolResult, BeforeToolCallResult } from '@earendil-works/pi-agent-core';
import type { OutboundCard } from '../../shared/outbound.ts';
import type { Ask } from '../../shared/state.ts';
import type { AskDesk, AskResolver, Changes } from '../attention/index.ts';
import { argsDigest } from '../system/index.ts';
import type { LineApproval, StateService } from '../state/index.ts';
import { clip } from './messages.ts';
import { HARD_LINE_LABELS, type HardLineKind, type KernelTool, type LineScope, type ToolArgs } from './types.ts';
import type { AnswerWaits } from './waits.ts';
import { OutboundGate } from './outbound.ts';

export const APPROVAL_PURPOSE = 'line_approval';
const ALLOW = 'allow';
const REVISE = 'revise';
const DENY = 'deny';
const ARGS_PREVIEW_CHARS = 1_500;
const QUESTION_CHARS = 40;

const DEFAULT_CONSEQUENCES: Readonly<Record<HardLineKind, string>> = {
  spend: '会花钱，付出去就要不回来。',
  outward: '会以你的名义发出去，对方会收到，撤不回。',
  irreversible: '做了就撤不回。',
  permission: '会改变谁能做什么。',
  in_person: '这件事要你本人做。',
};

export type GateState = Pick<StateService, 'lineApprovals' | 'asks' | 'transaction' | 'outboundGrants' | 'outboundLog'
  | 'groupMessages'
  | 'lines' | 'projects' | 'schedules' | 'contactMessages'>;

export interface GateHost {
  state: GateState;
  desk: AskDesk;
  waits: AnswerWaits;
  waiting(lineId: string, on: boolean): void;
  now(): Date;
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
  readonly #outbound: OutboundGate;

  constructor(host: GateHost) {
    this.#host = host;
    this.#outbound = new OutboundGate(host.state, () => host.now());
  }

  recover(): void { this.#host.state.outboundLog.recoverPending(); }

  async check(scope: LineScope, tool: KernelTool, toolCall: AgentToolCall, args: ToolArgs,
    signal: AbortSignal | undefined): Promise<BeforeToolCallResult | undefined> {
    const outbound = tool.outbound?.(args) ?? null;
    const kind = tool.hardLine(args) ?? (outbound === null ? null : 'outward');
    if (kind === null) {
      return undefined;
    }
    const digest = argsDigest(args);
    const call = { toolCallId: toolCall.id, toolName: tool.name, argsDigest: digest };
    const scopeContext = this.#outbound.context(scope);
    const previous = this.#host.state.lineApprovals.forCall(scope.lineId, toolCall.id);
    if (kind === 'outward' && outbound !== null && previous === undefined) {
      if (this.#host.state.outboundLog.forCall(scope.lineId, toolCall.id) !== undefined) {
        return { block: true, reason: '这次对外调用已经放行过，结果请查发送记录；没有重复执行。' };
      }
      if (signal?.aborted !== true && this.#outbound.authorizer.claim(scopeContext, call, outbound) !== null) {
        return undefined;
      }
    }
    let approval = previous ?? this.#raise(scope, tool, toolCall, args, kind, digest,
        kind === 'outward' && outbound !== null ? this.#outbound.card(scope, outbound) : null);
    if (approval.toolName !== toolCall.name || approval.argsDigest !== digest) {
      return { block: true, reason: '这次调用的参数和他批准的那次不一样，没有执行；要做得重新问他。' };
    }
    if (approval.status === 'pending') {
      approval = await this.#await(scope, approval, signal);
    }
    const decision = this.#decide(approval);
    if (decision !== undefined || kind !== 'outward' || outbound === null) { return decision; }
    const current = tool.outbound?.(args) ?? null;
    if (current === null || signal?.aborted === true
      || this.#outbound.authorizer.claim(scopeContext, call, current) === null) {
      return { block: true, reason: '这次发送不在当前授权范围内，或授权已用完、到期、撤销；没有执行，请重新确认。' };
    }
    return undefined;
  }

  settled(lineId: string, toolCallId: string, tool: KernelTool, result: AgentToolResult<unknown> | undefined,
    isError: boolean): void {
    this.#outbound.settled(lineId, toolCallId, tool, result, isError);
  }

  #raise(scope: LineScope, tool: KernelTool, toolCall: AgentToolCall, args: ToolArgs, kind: HardLineKind,
    digest: string, outbound: OutboundCard | null): LineApproval {
    const { desk, state } = this.#host;
    return desk.commit((changes) => {
      const ask = desk.raise(changes, {
        kind: 'approve',
        purpose: APPROVAL_PURPOSE,
        question: question(tool, args),
        detail: outbound === null ? detail(tool, args, kind)
          : `${tool.consequence?.(args) ?? DEFAULT_CONSEQUENCES.outward}\n`
            + '只在卡上确认的主体、账号、对象、内容和有效期内执行；超出范围仍需确认。',
        options: outbound?.relatedGrantId != null ? [
          { id: 'extend', label: '加进授权', recommended: true },
          { id: 'once', label: '只发这一次' }, { id: DENY, label: '先不' },
        ] : [
          { id: ALLOW, label: tool.approveLabel?.(args) ?? '同意这一次', recommended: true },
          { id: REVISE, label: '改一下' },
          { id: DENY, label: '先不' },
        ],
        actionId: `line-approval:${scope.lineId}:${toolCall.id}`,
        context: { lineId: scope.lineId, toolCallId: toolCall.id, tool: tool.name, hardLine: kind,
          ...(outbound === null ? {} : { outbound }),
          preview: tool.preview?.(args) ?? null },
        basis: 'hard_line',
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

  resolver(answered: (ask: Ask) => void): AskResolver {
    const { state } = this.#host;
    return {
      resolve: (changes, ask) => {
        const approval = state.lineApprovals.byAsk(ask.id);
        if (approval?.status !== 'pending' || ask.answer === null) {
          return;
        }
        const optionId = ask.answer.optionId;
        const text = ask.answer.text;
        const answer = optionId === REVISE ? `想改一下${text === null ? '' : `：${text}`}` : text;
        const allowing = optionId === ALLOW || optionId === 'once' || optionId === 'extend';
        if (allowing && ask.context?.outbound !== undefined) { this.#outbound.approve(ask, optionId); }
        state.lineApprovals.setStatus(approval.id, allowing ? 'approved' : 'declined',
          { from: 'pending', answer });
        changes.afterCommit(() => answered(ask));
      },
    };
  }
}

export function withdrawAsk(state: Pick<StateService, 'asks'>, changes: Changes, askId: string, at: string): void {
  const ask = state.asks.get(askId);
  if (ask?.status !== 'open') {
    return;
  }
  state.asks.update(ask.id, ask.version, { status: 'withdrawn', withdrawnAt: at });
  changes.ask(ask.id, 'updated');
}
