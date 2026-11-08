// CDP 的外部 JSON 在使用处按对应 schema 校验；不把原始错误（可能含页面输入）向上传递。
import { Type, type Static, type TSchema } from 'typebox';
import { Value } from 'typebox/value';
import { CloudToolError } from './errors.ts';

export const CdpEnvelopeSchema = Type.Object({
  id: Type.Optional(Type.Integer()), method: Type.Optional(Type.String()),
  sessionId: Type.Optional(Type.String()), result: Type.Optional(Type.Unknown()),
  params: Type.Optional(Type.Unknown()), error: Type.Optional(Type.Unknown()),
});
export type CdpEvent = Static<typeof CdpEnvelopeSchema>;
export const CdpVersionSchema = Type.Object({ webSocketDebuggerUrl: Type.String() });
export const CdpTargetsSchema = Type.Object({ targetInfos: Type.Array(Type.Object({
  targetId: Type.String(), type: Type.String(), title: Type.String(), url: Type.String(),
})) });
export const CdpSessionSchema = Type.Object({ sessionId: Type.String() });
export const CdpTargetSchema = Type.Object({ targetId: Type.String() });
export const CdpWindowSchema = Type.Object({ windowId: Type.Integer() });
export const CdpFrameTreeSchema = Type.Object({
  frameTree: Type.Object({ frame: Type.Object({ id: Type.String() }) }),
});
export const CdpFrameIdSchema = Type.Object({ frameId: Type.String() });
export const CdpNavigatedSchema = Type.Object({ frame: Type.Object({
  id: Type.String(), parentId: Type.Optional(Type.String()), url: Type.String(),
}) });
export const CdpWithinDocumentSchema = Type.Object({ frameId: Type.String(), url: Type.String() });
export const CdpLayoutSchema = Type.Object({ cssVisualViewport: Type.Object({
  pageX: Type.Number(), pageY: Type.Number(),
}) });
export const CdpHistorySchema = Type.Object({ currentIndex: Type.Integer(),
  entries: Type.Array(Type.Object({ id: Type.Integer() })) });
export const CdpDataSchema = Type.Object({ data: Type.String() });
export const CdpTextSchema = Type.Object({ result: Type.Object({ value: Type.String() }) });
export const CdpBooleanSchema = Type.Object({ result: Type.Object({ value: Type.Boolean() }) });
export const CdpFrameSchema = Type.Object({
  sessionId: Type.Integer(), data: Type.String({ maxLength: 4_000_000, pattern: '^[A-Za-z0-9+/=]+$' }),
  metadata: Type.Object({ deviceWidth: Type.Number({ exclusiveMinimum: 0, maximum: 4096 }),
    deviceHeight: Type.Number({ exclusiveMinimum: 0, maximum: 4096 }) }),
});

export function cdpValue<T extends TSchema>(schema: T, value: unknown): Static<T> {
  if (!Value.Check(schema, value)) {
    throw new CloudToolError('unknown', '浏览器回执格式不对，请重试连接并核对画面。');
  }
  return value;
}
