import { Value } from 'typebox/value';
import { OutboundSpecSchema, type OutboundGrant, type OutboundResult, type OutboundSpec }
  from '../../shared/outbound.ts';
import { MAIN_LINE_ID, type StateService } from '../state/index.ts';

export interface OutboundContext {
  actorId: string; lineId: string; projectId: string | null; scheduleId: string | null;
}
export interface OutboundInvocation { toolCallId: string; toolName: string; argsDigest: string }
type OutboundState = Pick<StateService, 'outboundGrants' | 'outboundLog' | 'lines' | 'projects' | 'schedules'>;

export class OutboundAuthorizer {
  readonly #state: OutboundState;
  readonly #now: () => Date;
  constructor(state: OutboundState, now: () => Date) { this.#state = state; this.#now = now; }

  matches(grant: OutboundGrant, scope: OutboundContext, spec: OutboundSpec): boolean {
    if (!Value.Check(OutboundSpecSchema, spec) || grant.legacyScheduleId !== null || !grant.enabled
      || grant.revokedAt !== null || grant.expiresAt !== null && Date.parse(grant.expiresAt) <= this.#now().getTime()
      || grant.scope.kind === 'once' && grant.usedCount > 0) { return false; }
    if (grant.actor !== scope.actorId || grant.channel !== spec.channel || grant.account !== spec.account
      || grant.category !== spec.category) { return false; }
    if (grant.recipientMode === 'list' && spec.recipients.some((recipient) => !grant.recipients.includes(recipient))) {
      return false;
    }
    if (grant.fixedTexts !== null && !grant.fixedTexts.includes(spec.content)) { return false; }
    if (grant.scope.kind !== 'task') { return true; }
    const binding = grant.scope.binding;
    if (binding.kind === 'line') {
      return binding.id !== MAIN_LINE_ID && binding.id === scope.lineId
        && this.#state.lines.get(scope.lineId)?.archivedAt === null;
    }
    if (binding.kind === 'schedule') {
      return binding.id === scope.scheduleId && this.#state.schedules.get(binding.id)?.status === 'active';
    }
    const project = this.#state.projects.get(binding.id);
    return binding.id === scope.projectId && project !== undefined && project.lifecycle !== 'done';
  }

  related(scope: OutboundContext, spec: OutboundSpec): OutboundGrant | undefined {
    return this.#state.outboundGrants.list().find((grant) => this.matches(grant, scope, { ...spec,
      recipients: grant.recipientMode === 'list' ? grant.recipients : spec.recipients,
      content: grant.fixedTexts?.[0] ?? spec.content,
    }));
  }

  claim(scope: OutboundContext, call: OutboundInvocation, spec: OutboundSpec) {
    if (this.#state.outboundLog.forCall(scope.lineId, call.toolCallId) !== undefined) { return null; }
    for (const grant of this.#state.outboundGrants.list()) {
      if (!this.matches(grant, scope, spec)) { continue; }
      const identity = { ...call, actor: scope.actorId, lineId: scope.lineId };
      const log = this.#state.outboundGrants.claim(grant, identity, spec);
      if (log !== null) { return { grant, log }; }
    }
    return null;
  }

  finish(lineId: string, toolCallId: string, result: OutboundResult): void {
    const log = this.#state.outboundLog.forCall(lineId, toolCallId);
    if (log !== undefined) { this.#state.outboundLog.finish(log.id, result); }
  }
}
