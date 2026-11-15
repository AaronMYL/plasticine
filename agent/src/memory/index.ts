// memory/：记忆（主线和队友共用）。按层分目录，每层回答一个问题：
// - docs/      现行的记忆文档（关于你、项目、人物、话题）：怎么写一行、怎么进上下文、读和「记住一句」的工具、联系人说的话进人物页
// - journal/   白天只记的「今天的记录」和「忘掉」
// - curation/  后台整理、全量整理、找说法冲突
// - dream/     每晚做梦：读什么、整理、「昨晚整理了什么」页上的撤销和挑选，和每晚 1 点到点叫它的定时（night.ts）
// - rules/     原来的「规则」那一份：改一行、整理、搬去 Soul 和「关于你」
// Soul 不在这里（mates/）。只经 state/ 读写库，模型调用经 kernel/ 的 TextModels。

export { addClaudeItems, applyCleanup, moveLine, runCleanup, startCleanup } from './curation/memory-cleanup.ts';
export { applyLayersMove, layersMoveView, undoLayersMove } from './curation/layers-move.ts';
export type { LayersMove, LayersMoveItem, LayersPlan } from './curation/layers-move.ts';
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
