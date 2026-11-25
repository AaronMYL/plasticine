import { Type, type Static } from 'typebox';
import { NoteFolderSchema, NoteMarkdownSchema } from '../state.ts';
import { ApiErrorSchema, IdSchema, RequestIdSchema } from './common.ts';

export const NOTE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const NOTE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export const NoteFoldersViewSchema = Type.Object({
  folders: Type.Array(Type.Object({ name: Type.String(), count: Type.Integer(), fixed: Type.Boolean() })),
  allCount: Type.Integer(), deletedCount: Type.Integer(), mergedCount: Type.Integer(),
});
export type NoteFoldersView = Static<typeof NoteFoldersViewSchema>;
export const NoteFolderCommandSchema = Type.Union([
  Type.Object({ requestId: RequestIdSchema, action: Type.Literal('create'), name: NoteFolderSchema }),
  Type.Object({ requestId: RequestIdSchema, action: Type.Literal('rename'), name: NoteFolderSchema,
    next: NoteFolderSchema }),
  Type.Object({ requestId: RequestIdSchema, action: Type.Literal('move'), name: NoteFolderSchema,
    direction: Type.Union([Type.Literal(-1), Type.Literal(1)]) }),
  Type.Object({ requestId: RequestIdSchema, action: Type.Literal('remove'), name: NoteFolderSchema,
    destination: NoteFolderSchema }),
]);
export type NoteFolderCommand = Static<typeof NoteFolderCommandSchema>;
export const NoteImageRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  type: Type.Enum(NOTE_IMAGE_TYPES),
  data: Type.String({ maxLength: Math.ceil(NOTE_IMAGE_MAX_BYTES / 3) * 4 }),
}, { additionalProperties: false });
export type NoteImageRequest = Static<typeof NoteImageRequestSchema>;
export const NoteImageViewSchema = Type.Object({ url: Type.String(), bytes: Type.Integer() });
export type NoteImageView = Static<typeof NoteImageViewSchema>;

export const NOTE_ASSIST_ACTIONS = [
  'predict', 'interject', 'polish', 'organize', 'correct', 'format', 'chart', 'custom',
] as const;
export const NOTE_ASSIST_CONTEXT_CHARS = 6000;
export const NOTE_PREDICT_BEFORE_CHARS = 1500;
export const NOTE_PREDICT_AFTER_CHARS = 300;
export const NOTE_ASSIST_DOCUMENT_CHARS = 24_000;
export const NOTE_ASSIST_SELECTION_CHARS = 12_000;
export const NoteAssistRequestSchema = Type.Object({
  action: Type.Enum(NOTE_ASSIST_ACTIONS),
  markdown: NoteMarkdownSchema,
  selected: Type.Optional(NoteMarkdownSchema),
  before: Type.Optional(Type.String({ maxLength: NOTE_ASSIST_CONTEXT_CHARS })),
  after: Type.Optional(Type.String({ maxLength: NOTE_ASSIST_CONTEXT_CHARS })),
  instruction: Type.Optional(Type.String({ maxLength: 4000 })),
  stream: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });
export type NoteAssistRequest = Static<typeof NoteAssistRequestSchema>;
export function noteAssistTimeoutMs(input: Pick<NoteAssistRequest, 'action' | 'selected'>): number {
  if (input.action === 'predict') { return 20_000; }
  if (input.action === 'interject' || input.selected !== undefined) { return 90_000; }
  return 150_000;
}
export const NoteSupplementReferenceSchema = Type.Object({ kind: Type.Enum(['contact', 'note']),
  id: Type.String({ minLength: 1 }), label: Type.String({ minLength: 1, maxLength: 120 }) },
{ additionalProperties: false });
export type NoteSupplementReference = Static<typeof NoteSupplementReferenceSchema>;
export const NoteSupplementsSchema = Type.Array(Type.Object({
  kind: Type.Enum(['structure', 'supplement', 'example', 'contact']),
  text: Type.String({ minLength: 1, maxLength: 120 }),
  draft: Type.String({ minLength: 1, maxLength: 12_000 }),
  reference: Type.Optional(NoteSupplementReferenceSchema),
  loopId: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
}, { additionalProperties: false }), { maxItems: 4 });
export type NoteSupplement = Static<typeof NoteSupplementsSchema>[number];

export const NoteAssistViewSchema = Type.Object({ markdown: Type.String(), label: Type.String(),
  suggestions: Type.Optional(NoteSupplementsSchema),
  loopId: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })) });
export type NoteAssistView = Static<typeof NoteAssistViewSchema>;

export const NoteAssistOutcomeSchema = Type.Object({
  area: Type.Enum(['note_predict', 'note_supplement']),
  loopId: Type.String({ minLength: 1, maxLength: 64 }),
  outcome: Type.Enum(['kept', 'rejected']),
}, { additionalProperties: false });
export type NoteAssistOutcome = Static<typeof NoteAssistOutcomeSchema>;
export const NoteAssistOutcomeViewSchema = Type.Object({ resolved: Type.Boolean() }, { additionalProperties: false });
export const NoteAssistStreamEventSchema = Type.Union([
  Type.Object({ type: Type.Literal('text'), delta: Type.String() }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal('done'), view: NoteAssistViewSchema }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal('error'), error: ApiErrorSchema }, { additionalProperties: false }),
]);
export type NoteAssistStreamEvent = Static<typeof NoteAssistStreamEventSchema>;
export const NoteImportDetailsSchema = Type.Object({
  variants: Type.Array(Type.Object({
    kind: Type.Enum(['original', 'corrected', 'polished']), markdown: NoteMarkdownSchema,
  })),
  mergedInto: Type.Union([IdSchema, Type.Null()]),
  originalIds: Type.Array(IdSchema),
  unresolvedIds: Type.Optional(Type.Array(Type.String())),
});
export type NoteImportDetails = Static<typeof NoteImportDetailsSchema>;
export const NoteImportViewSchema = Type.Object({
  ...NoteImportDetailsSchema.properties,
  links: Type.Array(Type.Object({ id: IdSchema, title: Type.String() })),
});
export type NoteImportView = Static<typeof NoteImportViewSchema>;
