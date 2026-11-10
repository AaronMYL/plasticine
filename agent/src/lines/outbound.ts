import { Value } from 'typebox/value';
import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import { OutboundCardSchema, OutboundResultSchema, type OutboundCard, type OutboundGrantInput,
  type OutboundSpec } from '../../shared/outbound.ts';
import type { Ask } from '../../shared/state.ts';
import { OutboundAuthorizer, settleNetworkOutbound, settleMessageOutbound, type OutboundContext }
  from '../outbound/index.ts';
import { MAIN_LINE_ID } from '../state/index.ts';
import type { GateState } from './hard-line.ts';
import type { KernelTool, LineScope } from './types.ts';
import { clip, resultSummary } from './messages.ts';

export class OutboundGate {
  readonly authorizer: OutboundAuthorizer;
  readonly #state: GateState;
  constructor(state: GateState, now: () => Date) {
    this.#state = state;
    this.authorizer = new OutboundAuthorizer(state, now);
  }

  context(scope: LineScope): OutboundContext {
    return { actorId: scope.actorId ?? MAIN_LINE_ID, lineId: scope.lineId, projectId: scope.projectId,
      scheduleId: this.#state.schedules.byLine(scope.lineId)?.id ?? null };
  }

  card(scope: LineScope, spec: OutboundSpec): OutboundCard {
    const who = this.context(scope);
    const related = this.authorizer.related(who, spec);
    const grant: OutboundGrantInput = { actor: who.actorId, channel: spec.channel, account: spec.account,
      recipientMode: 'list', recipients: [...spec.recipients], category: spec.category, fixedTexts: [spec.content],
      scope: { kind: 'once' }, expiresAt: null };
    if (related !== undefined) {
      grant.recipientMode = related.recipientMode;
      grant.recipients = [...new Set([...related.recipients, ...spec.recipients])];
      grant.fixedTexts = related.fixedTexts === null ? null : [...new Set([...related.fixedTexts, spec.content])];
      grant.scope = related.scope;
      grant.expiresAt = related.expiresAt;
    }
    return { requested: spec, grant, relatedGrantId: related?.id ?? null };
  }

  approve(ask: Ask, optionId: string | null): void {
    const card = ask.context?.outbound;
    if (!Value.Check(OutboundCardSchema, card) || ask.answeredByDeviceId === null || ask.answeredAt === null) {
      throw new Error('对外授权缺少范围或本人确认，不能放行。');
    }
    const confirmation = { deviceId: ask.answeredByDeviceId, confirmedAt: ask.answeredAt };
    const selected = card.grant;
    if (optionId === 'extend' && card.relatedGrantId !== null) {
      const before = this.#state.outboundGrants.require(card.relatedGrantId);
      if (before.actor !== selected.actor || before.channel !== selected.channel || before.account !== selected.account
        || before.category !== selected.category || before.legacyScheduleId !== null) {
        throw new Error('授权主体或渠道已变化，请重新核对范围。');
      }
      this.#state.outboundGrants.edit(before.id, before.version, selected, confirmation);
      return;
    }
    const grant = optionId === 'once' ? { ...selected, scope: { kind: 'once' as const },
      recipients: card.requested.recipients, recipientMode: 'list' as const,
      fixedTexts: [card.requested.content], expiresAt: null } : selected;
    this.#state.outboundGrants.create(grant, confirmation, { askId: ask.id });
  }

  settled(lineId: string, toolCallId: string, tool: KernelTool, result: AgentToolResult<unknown> | undefined,
    isError: boolean): void {
    const log = this.#state.outboundLog.forCall(lineId, toolCallId);
    if (log === undefined) { return; }
    const declared = result === undefined ? undefined : tool.outboundResult?.(result, isError);
    if (declared !== undefined && Value.Check(OutboundResultSchema, declared)) {
      this.authorizer.finish(lineId, toolCallId, declared);
      if (declared.sourceRef?.startsWith('network-task:') === true) {
        settleNetworkOutbound(this.#state, declared.sourceRef.slice('network-task:'.length));
      }
      if (declared.sourceRef?.startsWith('network-message:') === true
        || declared.sourceRef?.startsWith('network-group-message:') === true) {
        settleMessageOutbound(this.#state, declared.sourceRef);
      }
      return;
    }
    this.authorizer.finish(lineId, toolCallId, {
      status: isError || result === undefined ? 'unknown' : 'completed',
      summary: clip(resultSummary(result) ?? '工具没有返回可核对的结果。', 4_000), sourceRef: null,
    });
  }
}
