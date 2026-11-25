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
