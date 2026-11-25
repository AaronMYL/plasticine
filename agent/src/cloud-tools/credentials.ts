import { chmodSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CloudToolError } from './errors.ts';

export const CREDENTIALS_DIRECTORY = 'credentials';
export const CREDENTIAL_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const PRIVATE_MODE = 0o600;
const MODE_BITS = 0o777;

export type CredentialStatus = 'missing' | 'ready' | 'unsafe';

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export class CredentialFiles {
  readonly #directory: string;
  /** Windows has no POSIX modes; the 0600 check applies where it means something (Linux hosts). */
  readonly #checkMode: boolean;

  constructor(directory: string, checkMode: boolean = process.platform !== 'win32') {
    this.#directory = directory;
    this.#checkMode = checkMode;
  }

  #path(name: string): string {
    if (!CREDENTIAL_NAME_PATTERN.test(name)) {
      throw new CloudToolError('invalid_input', `凭据名「${name}」不合格式（小写字母、数字、-、_）。`, 'credential');
    }
    return join(this.#directory, name);
  }

  /** Whether the credential can be used, from the file's metadata only. */
  status(name: string): CredentialStatus {
    try {
      const stats = statSync(this.#path(name));
      if (!stats.isFile()) {
        return 'missing';
      }
      return this.#checkMode && (stats.mode & MODE_BITS) !== PRIVATE_MODE ? 'unsafe' : 'ready';
    } catch (error) {
      if (isMissing(error)) {
        return 'missing';
      }
      throw error;
    }
  }

  /** For a transport, at the moment it connects. Never log or store what comes back. */
  read(name: string): Buffer {
    const status = this.status(name);
    if (status === 'missing') {
      throw new CloudToolError('not_configured', `还没有放凭据「${name}」，这个工具暂时用不了。`, 'credential');
    }
    if (status === 'unsafe') {
      const next = `把 ${CREDENTIALS_DIRECTORY}/${name} 的权限改成 600 再试。`;
      throw new CloudToolError('credential_unsafe', `凭据「${name}」别的用户也能读，没有用它。${next}`, 'credential');
    }
    return readFileSync(this.#path(name));
  }

  write(name: string, data: string | null): void {
    const path = this.#path(name);
    if (data === null) {
      rmSync(path, { force: true });
      return;
    }
    mkdirSync(this.#directory, { recursive: true, mode: 0o700 });
    writeFileSync(path, data, { mode: PRIVATE_MODE });
    chmodSync(path, PRIVATE_MODE);
  }
}
