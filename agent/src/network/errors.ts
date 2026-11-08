// network/ 的拒绝：每种一句人话加下一步，app/api-error.ts 按 code 换成 HTTP 状态。

export const NETWORK_ERROR_CODES = [
  'not_joined',
  'already_joined',
  'not_found',
  'invalid_input',
  'conflict',
  'safety_changed',
  'relay_refused',
  'relay_unreachable',
] as const;
export type NetworkErrorCode = (typeof NETWORK_ERROR_CODES)[number];

export class NetworkError extends Error {
  readonly code: NetworkErrorCode;
  readonly field: string | undefined;

  constructor(code: NetworkErrorCode, message: string, field?: string) {
    super(message);
    this.name = 'NetworkError';
    this.code = code;
    this.field = field;
  }
}
