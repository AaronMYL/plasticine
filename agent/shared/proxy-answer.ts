import { Type, type Static } from 'typebox';

export const PROXY_ANSWER_MAX_CHARS = 2_000;

export const ProxyAnswerSchema = Type.Object({
  answer: Type.String({ maxLength: PROXY_ANSWER_MAX_CHARS }),
  confident: Type.Boolean(),
  usedMaterialIds: Type.Array(Type.String(), { maxItems: 50 }),
  needsOwner: Type.Boolean(),
});
export type ProxyAnswer = Static<typeof ProxyAnswerSchema>;

export interface ProxyMaterial {
  ref: string;
  kind: 'memory_topic' | 'project' | 'note' | 'space';
  title: string;
  text: string;
}

export interface ProxyLine {
  speaker: 'them' | 'their_ai' | 'me' | 'my_ai';
  name?: string;
  text: string;
}

