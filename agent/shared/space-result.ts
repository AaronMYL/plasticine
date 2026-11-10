import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';

export const SpaceToolResultSchema = Type.Object({
  id: Type.String({ minLength: 1 }), title: Type.String({ minLength: 1 }),
  version: Type.Integer({ minimum: 1 }), change: Type.String(),
  genre: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});
export type SpaceToolResult = Static<typeof SpaceToolResultSchema>;

/** 老工具结果可能只是文字，没有新版结果卡字段，仍按普通步骤显示。 */
export function spaceToolResult(tool: string | null, text: string): SpaceToolResult | null {
  if (tool !== 'space_write' && tool !== 'space_edit') return null;
  let value: unknown;
  try { value = JSON.parse(text); } catch { return null; }
  if (!Value.Check(SpaceToolResultSchema, value)) return null;
  return { id: value.id, title: value.title, version: value.version, change: value.change,
    ...(value.genre === undefined ? {} : { genre: value.genre }) };
}
