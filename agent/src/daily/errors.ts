// What daily/ refuses (a link with credentials in it, a concern that does not exist …), with the sentence app/ answers.

/** unreachable（第13批）：网站连不上、超时、对方出错——不是他填错了，原话告诉他。 */
export const DAILY_ERROR_CODES = ['not_found', 'invalid_input', 'conflict', 'no_feed', 'rate_limited',
  'unreachable'] as const;
export type DailyErrorCode = (typeof DAILY_ERROR_CODES)[number];

export class DailyError extends Error {
  readonly code: DailyErrorCode;
  readonly field: string | undefined;
  /** 这句是 daily/ 自己写给人看的（订阅地址打不开、不是订阅源……），接口照原话回；没标的只回一句通用的。 */
  readonly shown: boolean;

  constructor(code: DailyErrorCode, message: string, field?: string, shown = false) {
    super(message);
    this.name = 'DailyError';
    this.code = code;
    this.field = field;
    this.shown = shown;
  }
}

/** 写给人看的说法（第13批：加订阅、刷新订阅说真实原因，不再归成一句「输入不合要求」）。 */
export function shownError(code: DailyErrorCode, message: string, field?: string): DailyError {
  return new DailyError(code, message, field, true);
}
