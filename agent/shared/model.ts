// Unified model-layer formats: messages, tool definitions, stream events and requests.
// Decisions 10-26 第 20 条: every provider speaks this one format, so business code never sees provider wire shapes.
// Defined with typebox so the client and other modules import the same types instead of hand-writing them.

import { Type, type Static } from 'typebox';

export const ReasoningLevelSchema = Type.Union([
  Type.Literal('off'),
  Type.Literal('minimal'),
  Type.Literal('low'),
  Type.Literal('medium'),
  Type.Literal('high'),
  Type.Literal('xhigh'),
  Type.Literal('max'),
  // Above max; only some subscription models offer it (model/catalog.ts).
  Type.Literal('ultra'),
]);
export type ReasoningLevel = Static<typeof ReasoningLevelSchema>;

/** Public Responses assistant-item metadata; separate from any private reasoning content. */
export const AssistantPhaseSchema = Type.Union([
  Type.Literal('commentary'), Type.Literal('final_answer'), Type.Null(),
]);

export const TextBlockSchema = Type.Object({
  type: Type.Literal('text'),
  text: Type.String(),
  // Each Responses output message becomes one text block. A single response may contain different phases.
  phase: Type.Optional(AssistantPhaseSchema),
});

/** Arguments are already parsed; a call whose JSON did not parse never becomes a block. */
export const ToolCallBlockSchema = Type.Object({
  type: Type.Literal('tool_call'),
  id: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1 }),
  arguments: Type.Record(Type.String(), Type.Unknown()),
});

export const SystemMessageSchema = Type.Object({
  role: Type.Literal('system'),
  content: Type.String(),
});

export const ModelImageSchema = Type.Object({
  type: Type.Literal('image'), attachmentId: Type.String(),
  mimeType: Type.Enum(['image/png', 'image/jpeg', 'image/webp']), data: Type.String({ minLength: 1 }),
});
export type ModelImage = Static<typeof ModelImageSchema>;

export const UserMessageSchema = Type.Object({
  role: Type.Literal('user'),
  content: Type.String(),
  images: Type.Optional(Type.Array(ModelImageSchema)),
});

export const AssistantMessageSchema = Type.Object({
  role: Type.Literal('assistant'),
  content: Type.Array(Type.Union([TextBlockSchema, ToolCallBlockSchema])),
});
export type AssistantMessage = Static<typeof AssistantMessageSchema>;

export const ToolResultMessageSchema = Type.Object({
  role: Type.Literal('tool_result'),
  toolCallId: Type.String({ minLength: 1 }),
  toolName: Type.String({ minLength: 1 }),
  content: Type.String(),
  images: Type.Optional(Type.Array(ModelImageSchema)),
  isError: Type.Optional(Type.Boolean()),
});

export const MessageSchema = Type.Union([
  SystemMessageSchema,
  UserMessageSchema,
  AssistantMessageSchema,
  ToolResultMessageSchema,
]);
export type Message = Static<typeof MessageSchema>;

/** `parameters` is a JSON Schema object, normally produced by typebox in the tool's own file. */
export const ToolDefinitionSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  description: Type.String(),
  parameters: Type.Record(Type.String(), Type.Unknown()),
});
export type ToolDefinition = Static<typeof ToolDefinitionSchema>;

const Count = Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]);

/**
 * Metering read only from provider events. `unknown` with null counts means no event reported usage;
 * it is never filled with zeros (old observeUsage semantics). `input` includes cached tokens.
 */
export const UsageSchema = Type.Object({
  status: Type.Union([Type.Literal('observed'), Type.Literal('unknown')]),
  source: Type.Union([Type.Literal('provider-event'), Type.Null()]),
  input: Count,
  output: Count,
  cacheRead: Count,
  cacheWrite: Count,
  reasoning: Count,
  total: Count,
  eventTypes: Type.Array(Type.String()),
});

