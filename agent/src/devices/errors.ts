// What devices/ refuses with; app/ maps each code to an HTTP answer (api-error.ts). The message is one Chinese
// sentence for the user and never carries a credential or a pairing code.

export const DEVICE_ERROR_CODES = [
  'not_found',
  'pairing_code_invalid',
  'pairing_code_expired',
  'pairing_code_used',
  'credential_invalid',
  'node_revoked',
  'version_conflict',
  'action_conflict',
  'invalid_input',
] as const;
export type DeviceErrorCode = (typeof DEVICE_ERROR_CODES)[number];

export class DeviceError extends Error {
  readonly code: DeviceErrorCode;
  readonly field: string | undefined;
  readonly currentVersion: number | undefined;

  constructor(code: DeviceErrorCode, message: string, details: { field?: string; currentVersion?: number } = {}) {
    super(message);
    this.name = 'DeviceError';
    this.code = code;
    this.field = details.field;
    this.currentVersion = details.currentVersion;
  }
}
