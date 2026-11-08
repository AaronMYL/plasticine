// The error attention/ throws for a card request it refuses; app/ maps it onto the API error format.

export const ATTENTION_ERROR_CODES = [
  'not_found',
  // Answered or withdrawn already: a second answer from another device is refused, not silently applied.
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
