export const DAILY_ERROR_CODES = ['not_found', 'invalid_input', 'conflict', 'no_feed', 'rate_limited',
  'unreachable'] as const;
export type DailyErrorCode = (typeof DAILY_ERROR_CODES)[number];

export class DailyError extends Error {
  readonly code: DailyErrorCode;
  readonly field: string | undefined;
  readonly shown: boolean;

  constructor(code: DailyErrorCode, message: string, field?: string, shown = false) {
    super(message);
    this.name = 'DailyError';
    this.code = code;
    this.field = field;
    this.shown = shown;
  }
}

export function shownError(code: DailyErrorCode, message: string, field?: string): DailyError {
  return new DailyError(code, message, field, true);
}
