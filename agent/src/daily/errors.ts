// What daily/ refuses (a link with credentials in it, a concern that does not exist …), with the sentence app/ answers.

/** unreachable（第13批）：网站连不上、超时、对方出错——不是他填错了，原话告诉他。 */
export const DAILY_ERROR_CODES = ['not_found', 'invalid_input', 'conflict', 'no_feed', 'rate_limited',
  'unreachable'] as const;
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
