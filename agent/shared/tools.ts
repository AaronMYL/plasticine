import { Type, type Static } from 'typebox';
import { Nullable } from './state.ts';
import { ModelImageSchema } from './model.ts';

const STRICT = { additionalProperties: false };

/** Which turns see a tool (§5.2 `roles`); the verifier only ever gets read tools (decision 77). */
export const TOOL_ROLES = ['conversation', 'worker', 'verifier', 'diagnosis'] as const;
export const ToolRoleSchema = Type.Enum(TOOL_ROLES);
export type ToolRole = Static<typeof ToolRoleSchema>;

/** `safe`: may run again (reads, naturally idempotent writes). `once`: must run at most once per action id. */
export const TOOL_REPLAYS = ['safe', 'once'] as const;
/** `internal` writes only proposal fields and internal records; `external` reaches mail, devices, outside services. */
export const TOOL_EFFECTS = ['read', 'internal', 'external'] as const;
export const TOOL_PERMISSIONS = ['auto', 'agreement', 'approve'] as const;

export const DEFAULT_MAX_RESULT_CHARS = 10_000;
export const TOOL_NAME_PATTERN = '^[a-z][a-z0-9_]{0,63}$';

/** A tool's parameters: a JSON Schema for an object, as plain JSON (what the model receives). */
export const ToolParametersSchema = Type.Object({ type: Type.Literal('object') });

/** Everything about a tool except its `execute` function, with defaults already filled in. */
export const ToolDescriptorSchema = Type.Object(
  {
    name: Type.String({ pattern: TOOL_NAME_PATTERN }),
    label: Type.String({ minLength: 1 }),
    description: Type.String({ minLength: 1 }),
    parameters: ToolParametersSchema,
    replay: Type.Enum(TOOL_REPLAYS),
    effect: Type.Enum(TOOL_EFFECTS),
    parallel: Type.Boolean(),
    permission: Type.Enum(TOOL_PERMISSIONS),
    roles: Type.Array(ToolRoleSchema, { minItems: 1, uniqueItems: true }),
    timeoutMs: Type.Integer({ minimum: 1 }),
    maxResultChars: Type.Integer({ minimum: 1 }),
  },
  STRICT,
);
export type ToolDescriptor = Static<typeof ToolDescriptorSchema>;

export const TOOL_OUTCOMES = ['ok', 'error', 'needs_permission', 'unknown', 'dry_run', 'queued'] as const;
export const ToolOutcomeSchema = Type.Enum(TOOL_OUTCOMES);

export const TOOL_ERROR_CODES = [
  'unknown_tool',
  'invalid_arguments',
  'execution_failed',
  'timeout',
  'aborted',
  'permission_required',
  'result_unknown',
  'action_conflict',
] as const;
export const ToolErrorCodeSchema = Type.Enum(TOOL_ERROR_CODES);

/** One call's result, in the call's original position; `content` is exactly what the model is shown. */
export const ToolResultSchema = Type.Object(
  {
    callId: Type.String({ minLength: 1 }),
    tool: Type.String({ minLength: 1 }),
    outcome: ToolOutcomeSchema,
    content: Type.String(),
    images: Type.Optional(Type.Array(ModelImageSchema, { maxItems: 4 })),
    errorCode: Nullable(ToolErrorCodeSchema),
    actionId: Nullable(Type.String({ minLength: 1 })),
    reused: Type.Boolean(),
    truncated: Type.Boolean(),
    totalChars: Type.Integer({ minimum: 0 }),
  },
  STRICT,
);
export type ToolResult = Static<typeof ToolResultSchema>;
