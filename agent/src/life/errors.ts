// What life/ refuses (转账没选两个账户、已经有一段专注在跑 …), with the sentence app/ answers.

export const LIFE_ERROR_CODES = ['not_found', 'invalid_input', 'conflict'] as const;
export type LifeErrorCode = (typeof LIFE_ERROR_CODES)[number];

export class LifeError extends Error {
  readonly code: LifeErrorCode;
  readonly field: string | undefined;

  constructor(code: LifeErrorCode, message: string, field?: string) {
    super(message);
    this.name = 'LifeError';
    this.code = code;
    this.field = field;
  }
}
