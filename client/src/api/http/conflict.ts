// 409 的回答带着服务端现在那一条（记忆条目、判断、约定、关切、信息流条目各有自己的 current）：认出来就换成带 current
// 的 ConflictError，交给界面对照；current 不合 schema 就不认，走通用分类（还是 conflict，只是没有可对照的）。
// 默认只认 version_conflict；回来汇报的 already_read / not_ready 也带 current，调用方另给 codes。

import type { Static, TSchema } from 'typebox';
import { Value } from 'typebox/value';
import { ConflictError, type ApiError } from '../errors.ts';
import { ApiErrorSchema } from '../shared.ts';

const VERSION_CONFLICT: readonly string[] = ['version_conflict'];

export function conflictWith<T extends TSchema>(
  currentSchema: T,
  codes: readonly string[] = VERSION_CONFLICT,
): (status: number, body: unknown) => ApiError | undefined {
  return (status, body) => {
    if (status !== 409 || !Value.Check(ApiErrorSchema, body) || !codes.includes(body.code)) {
      return undefined;
    }
    const current: unknown = 'current' in body ? body.current : undefined;
    if (!Value.Check(currentSchema, current)) {
      return undefined;
    }
    return new ConflictError<Static<T>>(current, body.error, body.next, body.code);
  };
}
