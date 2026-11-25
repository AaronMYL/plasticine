export const CLOUD_TOOL_ERROR_CODES = [
  'invalid_input',
  'not_configured',
  'credential_unsafe',
  'failed',
  'unknown',
  'user_takeover',
] as const;
export type CloudToolErrorCode = (typeof CLOUD_TOOL_ERROR_CODES)[number];

export class CloudToolError extends Error {
  readonly code: CloudToolErrorCode;
  readonly field: string | undefined;

  constructor(code: CloudToolErrorCode, message: string, field?: string) {
    super(message);
    this.name = 'CloudToolError';
    this.code = code;
    this.field = field;
  }
}
