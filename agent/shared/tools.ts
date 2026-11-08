// Tool definitions and tool results (harness design 10-27 §5.2). brain/ registers and dispatches tools; the client
// and later execution/ read the same shapes from here instead of keeping their own copy.

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
/** §5.2 权限分级. Tools that would write user-confirmed fields do not exist at all. */
export const TOOL_PERMISSIONS = ['auto', 'agreement', 'approve'] as const;

// 10 000 characters: the old version's page size for tool output (§5.2 工具定义表).
export const DEFAULT_MAX_RESULT_CHARS = 10_000;
// Model APIs accept [a-zA-Z0-9_-]{1,64}; Plasticine keeps to lower snake_case so names read the same everywhere.
export const TOOL_NAME_PATTERN = '^[a-z][a-z0-9_]{0,63}$';

/** A tool's parameters: a JSON Schema for an object, as plain JSON (what the model receives). */
export const ToolParametersSchema = Type.Object({ type: Type.Literal('object') });

/** Everything about a tool except its `execute` function, with defaults already filled in. */
export const ToolDescriptorSchema = Type.Object(
  {
    name: Type.String({ pattern: TOOL_NAME_PATTERN }),
    // 中文标签，界面显示用；name 给模型用。
    label: Type.String({ minLength: 1 }),
    // Sent to the model as the tool's description.
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

/**
 * `needs_permission`: not run, waiting for an agreement or the user's approval. `unknown`: it may or may not have
 * happened (an `issued` receipt without a result, or a once-tool that timed out); verify before doing it again.
 * `dry_run`: an external action recorded but not executed because the development switch is on (10-26 第 8 条).
 */
export const TOOL_OUTCOMES = ['ok', 'error', 'needs_permission', 'unknown', 'dry_run', 'queued'] as const;
export const ToolOutcomeSchema = Type.Enum(TOOL_OUTCOMES);
export type ToolOutcome = Static<typeof ToolOutcomeSchema>;

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
export type ToolErrorCode = Static<typeof ToolErrorCodeSchema>;

/** One call's result, in the call's original position; `content` is exactly what the model is shown. */
export const ToolResultSchema = Type.Object(
  {
    callId: Type.String({ minLength: 1 }),
    tool: Type.String({ minLength: 1 }),
    outcome: ToolOutcomeSchema,
    content: Type.String(),
    images: Type.Optional(Type.Array(ModelImageSchema, { maxItems: 4 })),
    errorCode: Nullable(ToolErrorCodeSchema),
    // Set when the call went through a receipt (once tools and every tool with an effect).
    actionId: Nullable(Type.String({ minLength: 1 })),
    // True when an earlier receipt's result was returned instead of running the tool again.
    reused: Type.Boolean(),
    truncated: Type.Boolean(),
    // Length of the full output in characters (code points), before truncation.
    totalChars: Type.Integer({ minimum: 0 }),
  },
  STRICT,
);
export type ToolResult = Static<typeof ToolResultSchema>;
