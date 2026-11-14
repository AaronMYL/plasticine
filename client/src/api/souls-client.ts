// 主线和每位队友的 Soul、规则搬家（第13批；agent/shared/api/souls.ts、rules-move.ts）。
import type { ApplyRulesMoveRequest, ApplyRulesMoveResponse, RulesMoveResponse, SoulResponse,
  SoulRevisionDiffResponse, UndoSoulRequest, UpdateSoulRequest } from './shared.ts';

export interface SoulsApi {
  /** GET /v2/souls/:owner：这一份和最近的改动。owner 是 main 或队友 id。 */
  get(owner: string, signal?: AbortSignal): Promise<SoulResponse>;
  /** POST /v2/souls/:owner：他改。 */
  update(owner: string, input: UpdateSoulRequest): Promise<SoulResponse>;
  /** POST /v2/souls/:owner/undo：撤回一次改动。 */
  undo(owner: string, input: UndoSoulRequest): Promise<SoulResponse>;
  /** GET /v2/souls/:owner/revisions/:id：看这一次改了什么。 */
  revision(owner: string, id: string, signal?: AbortSignal): Promise<SoulRevisionDiffResponse>;
  /** GET /v2/memory/rules-move：还在「规则」里的每一条和建议去处。 */
  rulesMove(signal?: AbortSignal): Promise<RulesMoveResponse>;
  /** POST /v2/memory/rules-move：照勾的搬。 */
  applyRulesMove(input: ApplyRulesMoveRequest): Promise<ApplyRulesMoveResponse>;
}
