// device_action 给模型看的那一面（内核优化第四批，11-17）：原来的参数是 60 多种动作的整个联合，声明有 1.9 万字符，
// 占了一次请求工具声明的五分之一。这里给模型一份松的——action 只写 kind 的枚举，别的参数放开——每种动作要哪些
// 参数写成一行一种的签名放进说明（从同一份联合自动生成，改了动作这里跟着变）。执行前照样按原来的联合严格核
// （lines/legacy.ts），核不过回一句这一种要哪些参数。设备协议不变。
// 不列给模型的：tab_click（线上两周 20 次全错，都是猜选择器、猜字没找到；用 tab_perceive + tab_act）、tab_show
// （会抢他的屏幕，只给 tab_handoff 用）、tab_upload / file_fetch / file_put（有专门的工具）。

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

/** 每种动作一行签名：「tab_read(tabId:str,offset:int)」，? 是可以不写的，| 是几选一。 */
export const ACTION_SIGNATURES = SHOWN.map((variant) => variant.signature).join('\n');

/** 给模型看的参数：kind 是枚举，别的按说明里的签名写。 */
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

/** 严格核没过：这一种要哪些参数。 */
export function actionHint(args: unknown): string | null {
  const action = typeof args === 'object' && args !== null ? Reflect.get(args, 'action') : undefined;
  const kind = typeof action === 'object' && action !== null ? Reflect.get(action, 'kind') : undefined;
  const variant = VARIANTS.find((item) => item.kind === kind);
  return variant === undefined ? '没有这种动作；看 action 说明里列的。' : `这一种要：${variant.signature}。`;
}
