// What cloud-tools/ refuses or could not do, with the sentence app/ and the tools answer. A message never carries a
// credential, a server's raw reply or a URL with its query: only what was wrong and what to do next.

export const CLOUD_TOOL_ERROR_CODES = [
  // The input itself: a URL with a password in it, a host not on the list, a file too big …
  'invalid_input',
  // The tool has no transport or no credential yet (M5 connects none).
  'not_configured',
  // The credential file is there but readable by others (not 0600).
  'credential_unsafe',
  // The outside service said no or failed; it did not act.
  'failed',
  // Cut off: it may or may not have acted.
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
