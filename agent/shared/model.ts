// Unified model-layer formats: messages, tool definitions, stream events and requests.
// Decisions 10-26 第 20 条: every provider speaks this one format, so brain/ never sees provider wire shapes.
// Defined with typebox so the client and other modules import the same types instead of hand-writing them.

import { Type, type Static } from 'typebox';

/** Reasoning levels in ascending order; providers map each one to their own wire value (see model/catalog.ts). */
export const REASONING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;

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
export type AssistantPhase = Static<typeof AssistantPhaseSchema>;

export const TextBlockSchema = Type.Object({
  type: Type.Literal('text'),
  text: Type.String(),
  // Each Responses output message becomes one text block. A single response may contain different phases.
  phase: Type.Optional(AssistantPhaseSchema),
});
export type TextBlock = Static<typeof TextBlockSchema>;

/** Arguments are already parsed; a call whose JSON did not parse never becomes a block. */
export const ToolCallBlockSchema = Type.Object({
  type: Type.Literal('tool_call'),
  id: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1 }),
  arguments: Type.Record(Type.String(), Type.Unknown()),
});
export type ToolCallBlock = Static<typeof ToolCallBlockSchema>;

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
export type UserImage = NonNullable<Static<typeof UserMessageSchema>['images']>[number];

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

export const ModelRequestSchema = Type.Object({
  model: Type.String({ minLength: 1 }),
  messages: Type.Array(MessageSchema),
  tools: Type.Optional(Type.Array(ToolDefinitionSchema)),
  reasoning: Type.Optional(ReasoningLevelSchema),
  apiModel: Type.Optional(Type.String({ minLength: 1 })),
  // Responses API 的预算包含可见输出和推理；短补全仍需给推理留出余量。
  maxOutputTokens: Type.Optional(Type.Integer({ minimum: 16, maximum: 128_000 })),
  // Lets the provider reuse its prompt cache across turns of one conversation; never a secret.
  sessionId: Type.Optional(Type.String({ minLength: 1 })),
});
export type ModelRequest = Static<typeof ModelRequestSchema>;

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
export type Usage = Static<typeof UsageSchema>;

export const ModelErrorKindSchema = Type.Union([
  Type.Literal('auth'),
  Type.Literal('quota'),
  Type.Literal('rate_limit'),
  Type.Literal('overloaded'),
  Type.Literal('server'),
  Type.Literal('timeout'),
  Type.Literal('network'),
  Type.Literal('context_overflow'),
  Type.Literal('format'),
  Type.Literal('aborted'),
  Type.Literal('unknown'),
]);
export type ModelErrorKind = Static<typeof ModelErrorKindSchema>;

/** `message` is the Chinese sentence for the user; `detail` is the provider's own text for the run record. */
export const ModelErrorInfoSchema = Type.Object({
  kind: ModelErrorKindSchema,
  message: Type.String(),
  retryable: Type.Boolean(),
  code: Type.Optional(Type.String()),
  status: Type.Optional(Type.Integer()),
  // ISO time after which the same request may succeed (quota reset or Retry-After).
  retryAt: Type.Optional(Type.String()),
  detail: Type.Optional(Type.String()),
});
export type ModelErrorInfo = Static<typeof ModelErrorInfoSchema>;

export const StopReasonSchema = Type.Union([Type.Literal('stop'), Type.Literal('tool_use'), Type.Literal('length')]);
export type StopReason = Static<typeof StopReasonSchema>;

export const ModelEventSchema = Type.Union([
  Type.Object({ type: Type.Literal('model_selected'), model: Type.String(),
    provider: Type.String(), reasoning: Type.Union([Type.String(), Type.Null()]) }),
  Type.Object({ type: Type.Literal('text_delta'), delta: Type.String() }),
  Type.Object({ type: Type.Literal('reasoning_delta'), delta: Type.String() }),
  Type.Object({ type: Type.Literal('tool_call_start'), id: Type.String(), name: Type.String() }),
  Type.Object({ type: Type.Literal('tool_call_delta'), id: Type.String(), delta: Type.String() }),
  Type.Object({ type: Type.Literal('tool_call_end'), call: ToolCallBlockSchema }),
  Type.Object({ type: Type.Literal('usage'), usage: UsageSchema }),
  // Emitted by model/retry.ts: everything streamed since the last start belongs to a failed attempt.
  Type.Object({
    type: Type.Literal('retry'),
    attempt: Type.Integer({ minimum: 1 }),
    delayMs: Type.Integer({ minimum: 0 }),
    error: ModelErrorInfoSchema,
    // What the failed attempt used (from `response.failed`, or unknown); it is billed even though it is dropped.
    usage: UsageSchema,
  }),
  Type.Object({
    type: Type.Literal('done'),
    stopReason: StopReasonSchema,
    message: AssistantMessageSchema,
    usage: UsageSchema,
  }),
  // Terminal. `partial` keeps the text and the finished tool calls received before the failure.
  Type.Object({
    type: Type.Literal('error'),
    error: ModelErrorInfoSchema,
    partial: AssistantMessageSchema,
    usage: UsageSchema,
  }),
]);
export type ModelEvent = Static<typeof ModelEventSchema>;
