// What daily/ refuses (a link with credentials in it, a concern that does not exist …), with the sentence app/ answers.

export const DAILY_ERROR_CODES = ['not_found', 'invalid_input', 'conflict', 'no_feed'] as const;
export type DailyErrorCode = (typeof DAILY_ERROR_CODES)[number];

export class DailyError extends Error {
  readonly code: DailyErrorCode;
  readonly field: string | undefined;

  constructor(code: DailyErrorCode, message: string, field?: string) {
    super(message);
    this.name = 'DailyError';
    this.code = code;
    this.field = field;
  }
}
