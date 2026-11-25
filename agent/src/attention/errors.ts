export const ATTENTION_ERROR_CODES = [
  'not_found',
  'ask_closed',
  'invalid_answer',
  'invalid_ask',
  'invalid_subscription',
] as const;
export type AttentionErrorCode = (typeof ATTENTION_ERROR_CODES)[number];

export class AttentionError extends Error {
  readonly code: AttentionErrorCode;
  readonly field: string | undefined;

  constructor(code: AttentionErrorCode, message: string, field?: string) {
    super(message);
    this.name = 'AttentionError';
    this.code = code;
    this.field = field;
  }
}
