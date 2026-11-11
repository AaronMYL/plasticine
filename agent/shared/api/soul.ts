import { Type, type Static } from 'typebox';
import { API_PREFIX, IdSchema, IsoTimeSchema, RequestIdSchema } from './common.ts';
import { MemoryLineSourceSchema } from './memory-topics.ts';

export const SOUL_PATH = `${API_PREFIX}/soul`;
export const SOUL_SECTIONS = ['speaking', 'doing', 'outbound'] as const;
export type SoulSection = (typeof SOUL_SECTIONS)[number];
export const SOUL_SECTION_LABELS: Readonly<Record<SoulSection, string>> = {
  speaking: '说话', doing: '做事', outbound: '对外',
};
/** user：在记忆页写的；conversation：对话里说的；inference：确认过的推断；mate：队友设定；system：系统默认。 */
export const SOUL_SOURCES = ['system', 'user', 'conversation', 'inference', 'mate'] as const;
/** 规则的适用范围（11-11）：全部，或只对某位队友。 */
export const RULE_SCOPE_KINDS = ['all', 'mate'] as const;
export const SoulLineSchema = Type.Object({
  id: IdSchema, version: Type.Integer({ minimum: 0 }), text: Type.String({ minLength: 1 }),
  section: Type.Enum(SOUL_SECTIONS), source: Type.Enum(SOUL_SOURCES), at: IsoTimeSchema,
  sources: Type.Array(MemoryLineSourceSchema),
  scopeKind: Type.Enum(RULE_SCOPE_KINDS), scopeRef: Type.Union([IdSchema, Type.Null()]),
});
export type SoulLine = Static<typeof SoulLineSchema>;
export const SoulChangeSchema = Type.Object({
  id: IdSchema, lineId: IdSchema, action: Type.Enum(['add', 'edit', 'move', 'undo', 'scope']),
  text: Type.String(), at: IsoTimeSchema, actor: Type.Enum(['system', 'user', 'brain']),
});
export type SoulChange = Static<typeof SoulChangeSchema>;
export const SoulViewSchema = Type.Object({
  title: Type.String(), lines: Type.Array(SoulLineSchema), history: Type.Array(SoulChangeSchema),
});
export type SoulView = Static<typeof SoulViewSchema>;
const identity = { requestId: RequestIdSchema };
const target = { id: IdSchema, version: Type.Integer({ minimum: 0 }) };
const content = { text: Type.String({ minLength: 1, maxLength: 500 }), section: Type.Enum(SOUL_SECTIONS) };
const strict = { additionalProperties: false };
export const ChangeSoulRequestSchema = Type.Union([
  Type.Object({ ...identity, action: Type.Literal('add'), ...content,
    scopeKind: Type.Optional(Type.Enum(RULE_SCOPE_KINDS)),
    scopeRef: Type.Optional(Type.Union([IdSchema, Type.Null()])) },
  strict),
  Type.Object({ ...identity, action: Type.Literal('edit'), ...target, ...content }, strict),
  Type.Object({ ...identity, action: Type.Literal('move'), ...target, section: Type.Enum(SOUL_SECTIONS) }, strict),
  Type.Object({ ...identity, action: Type.Literal('undo'), ...target }, strict),
  Type.Object({ ...identity, action: Type.Literal('scope'), ...target, scopeKind: Type.Enum(RULE_SCOPE_KINDS),
    scopeRef: Type.Union([IdSchema, Type.Null()]) }, strict),
]);
export type ChangeSoulRequest = Static<typeof ChangeSoulRequestSchema>;
