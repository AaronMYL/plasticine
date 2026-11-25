import type { ApplyRulesMoveRequest, ApplyRulesMoveResponse, RulesMoveResponse, SoulResponse,
  SoulRevisionDiffResponse, UndoSoulRequest, UpdateSoulRequest } from './shared.ts';

export interface SoulsApi {
  get(owner: string, signal?: AbortSignal): Promise<SoulResponse>;
  update(owner: string, input: UpdateSoulRequest): Promise<SoulResponse>;
  undo(owner: string, input: UndoSoulRequest): Promise<SoulResponse>;
  revision(owner: string, id: string, signal?: AbortSignal): Promise<SoulRevisionDiffResponse>;
  rulesMove(signal?: AbortSignal): Promise<RulesMoveResponse>;
  applyRulesMove(input: ApplyRulesMoveRequest): Promise<ApplyRulesMoveResponse>;
}
