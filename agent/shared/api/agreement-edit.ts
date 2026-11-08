// 生效约定的编辑请求（POST /v2/agreements/:id/edit，本人会话确认）。原来这里还有认知页的整套普通写入（判断、证据、≠），
// 2026-11-05 那些功能删了，只剩这一份。
import { Type, type Static } from 'typebox';
import { RequestIdSchema } from './common.ts';

export const AgreementEditFields = {
  text: Type.String({ minLength: 1, maxLength: 4_000 }),
  scope: Type.String({ maxLength: 4_000 }),
};
export const EditAgreementRequestSchema = Type.Object({
  requestId: RequestIdSchema, version: Type.Integer({ minimum: 1 }), ...AgreementEditFields,
}, { additionalProperties: false });
export type EditAgreementRequest = Static<typeof EditAgreementRequestSchema>;
