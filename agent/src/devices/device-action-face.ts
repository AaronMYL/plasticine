import { Type, type TSchema } from 'typebox';
import { DeviceActionParamsSchema } from '../../shared/api/index.ts';
import { NODE_ACTION_PURPOSE_MAX_CHARS } from '../../shared/state.ts';

export const HIDDEN_KINDS: ReadonlySet<string> = new Set(['tab_click', 'tab_show', 'tab_upload', 'file_fetch',
  'file_put']);

type Plain = Record<string, unknown>;

function hint(schema: Plain): string {
  if (schema['const'] !== undefined) {
    return JSON.stringify(schema['const']);
  }
  if (Array.isArray(schema['enum'])) {
    return schema['enum'].join('|');
  }
  if (Array.isArray(schema['anyOf'])) {
    return (schema['anyOf'] as Plain[]).map(hint).join('|');
  }
  switch (schema['type']) {
    case 'null': return 'null';
    case 'string': return 'str';
    case 'integer': return 'int';
    case 'number': return 'num';
    case 'boolean': return 'bool';
    case 'array': return `[${hint((schema['items'] ?? {}) as Plain)}]`;
    case 'object': return `{${fields(schema)}}`;
    default: return '?';
  }
}

function fields(schema: Plain): string {
  const required = new Set(Array.isArray(schema['required']) ? schema['required'] as string[] : []);
  const properties = (schema['properties'] ?? {}) as Record<string, Plain>;
  return Object.entries(properties).filter(([key]) => key !== 'kind')
    .map(([key, value]) => `${key}${required.has(key) ? '' : '?'}:${hint(value)}`).join(',');
}

interface Variant {
  kind: string;
  signature: string;
}

function variants(): Variant[] {
  const plain = JSON.parse(JSON.stringify(DeviceActionParamsSchema)) as { anyOf: Plain[] };
  return plain.anyOf.map((variant) => {
    const kind = String(((variant['properties'] as Record<string, Plain>)['kind'] ?? {})['const']);
    return { kind, signature: `${kind}(${fields(variant)})` };
  });
}

const VARIANTS = variants();
const SHOWN = VARIANTS.filter((variant) => !HIDDEN_KINDS.has(variant.kind));

export const ACTION_SIGNATURES = SHOWN.map((variant) => variant.signature).join('\n');

export function deviceActionFace(): TSchema {
  return Type.Object({
    nodeId: Type.String({ minLength: 1, description: 'The paired node (device service) to run it on' }),
    purpose: Type.String({ minLength: 2, maxLength: NODE_ACTION_PURPOSE_MAX_CHARS,
      description: 'What this action is for, in one sentence (e.g. "截图看日历有没有新邀请"); the lane is decided from it' }),
    action: Type.Object({ kind: Type.String({ enum: SHOWN.map((variant) => variant.kind) }) }, {
      additionalProperties: true,
      description: `One action, every parameter given; fields by kind (?: may omit, |: one of):\n${ACTION_SIGNATURES}`,
    }),
    needsLogin: Type.Optional(Type.Boolean({ description: 'true when the page needs his own sign-in (Mac browser)' })),
  }, { additionalProperties: false });
}

export function actionHint(args: unknown): string | null {
  const action = typeof args === 'object' && args !== null ? Reflect.get(args, 'action') : undefined;
  const kind = typeof action === 'object' && action !== null ? Reflect.get(action, 'kind') : undefined;
  const variant = VARIANTS.find((item) => item.kind === kind);
  return variant === undefined ? '没有这种动作；看 action 说明里列的。' : `这一种要：${variant.signature}。`;
}
