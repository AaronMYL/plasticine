// What artifacts/ refuses (a path that leaves the files directory, a file too big, a type it does not take …).

export const ARTIFACT_ERROR_CODES = [
  'not_found',
  'invalid_input',
  'conflict',
  'too_large',
  'unsupported_type',
] as const;
export type ArtifactErrorCode = (typeof ARTIFACT_ERROR_CODES)[number];

export class ArtifactError extends Error {
  readonly code: ArtifactErrorCode;
  readonly field: string | undefined;

  constructor(code: ArtifactErrorCode, message: string, field?: string) {
    super(message);
    this.name = 'ArtifactError';
    this.code = code;
    this.field = field;
  }
}
