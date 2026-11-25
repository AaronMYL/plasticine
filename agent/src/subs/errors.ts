export type SubsErrorCode = 'invalid' | 'conflict' | 'not_found';

export class SubsError extends Error {
  readonly code: SubsErrorCode;

  constructor(code: SubsErrorCode, message: string) {
    super(message);
    this.name = 'SubsError';
    this.code = code;
  }
}
