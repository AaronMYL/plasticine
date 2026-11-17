// loop/：预测闭环——各处的预测和用户的反应怎么记数、什么时候放手自己做、做梦时写的「自己的说明书」、预测消息。

export { askTopic, autoChoice, offerResolver, raiseOffer, recordAsk, settleAsk, topicProblem } from './autonomy.ts';
export { COMPOSE_TURNS, ComposePredictor } from './compose-predictor.ts';
export type { ComposeContext, ComposeTurn } from './compose-predictor.ts';
export { loopSection } from './prompt.ts';
export { loopReadings } from './readings.ts';
export { writeSelfNotes } from './self-notes.ts';
export { heldBack, recordSuggestion, settleSuggestion, suggestionTopic } from './suggestions.ts';
export { canonicalTopic, LOOP_AREAS, normalizeTopic } from './tally.ts';
export type { LoopArea, LoopOutcome, Tally } from './tally.ts';
export { loopTools } from './tools.ts';
export { predictHabits, recordPrediction, recordSupplements, supplementHabits } from './writing.ts';
