export { addClaudeItems, applyCleanup, moveLine, runCleanup, startCleanup } from './curation/memory-cleanup.ts';
export { applyLayersMove, layersMoveView, undoLayersMove } from './curation/layers-move.ts';
export type { LayersMove, LayersMoveItem } from './curation/layers-move.ts';
export { looksLikeSecret, sameThing } from './curation/memory-curation-ops.ts';
export type { CurationSource } from './curation/memory-curation-ops.ts';
export type { CurationState } from './curation/memory-curation-work.ts';
export { MemoryCurator } from './curation/memory-curator.ts';
export {
  addLine, decideInference, docEvent, docFullness, ensureGrantsDoc, ensureMemoryDocs, ensureProactiveDoc,
  ensureProjectDoc, ensureRulesDoc, retireLine, reviseLine,
} from './docs/memory-doc-writes.ts';
export type { DocState, Writer } from './docs/memory-doc-writes.ts';
export {
  findDoc, grantsDocSection, memoryDocView, memoryDocsSection, proactiveDocSection, rulesDocSection, searchMemory,
  todaySection,
} from './docs/memory-docs-context.ts';
export { noteExperience } from './docs/experience.ts';
export { recallExperience, touchedKeys } from './docs/experience-recall.ts';
export type { RecallCall } from './docs/experience-recall.ts';
export { Retrospector } from './retro/retrospect.ts';
export type { RetroDeps, RetroResult, RetroSkills } from './retro/retrospect.ts';
export type { RetroSkill } from './retro/retro-material.ts';
export type { ExperienceInput, ExperienceResult } from './docs/experience.ts';
export { createMemoryDocTools } from './docs/tools-docs.ts';
export { RememberParameters, rememberWithSources } from './docs/tools-remember.ts';
export { transcripts } from './dream/dream-material.ts';
export {
  DreamActionError, canUndoChange, chooseDreamCandidate, undoDreamChange,
} from './dream/memory-dream-actions.ts';
export { Dreamer } from './dream/memory-dream.ts';
export type { DreamInput, DreamReport, DreamSkills, DreamSuggest } from './dream/memory-dream.ts';
export { forgetMemory } from './journal/memory-journal.ts';
export { applyRulesMove, rulesMoveView } from './rules/rules-move.ts';
export { rewriteRules } from './rules/rules-rewrite.ts';
export { changeSoul, soulView } from './rules/soul.ts';
export { DreamNight } from './dream/night.ts';
