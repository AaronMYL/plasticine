import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface SecretCipher {
  available(): boolean;
  encrypt(text: string): Buffer;
  decrypt(data: Buffer): string;
}

function readOrNull(file: string): Buffer | null {
  try {
    return readFileSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export function serverKey(server: string): string {
  return createHash('sha256').update(`${new URL(server).origin}/`).digest('hex');
}

export class CredentialStore {
  private readonly directory: string;
  private readonly legacy: string | null;
  private readonly cipher: SecretCipher;

  constructor(directory: string, legacy: string | null, cipher: SecretCipher) {
    this.directory = directory;
    this.legacy = legacy;
    this.cipher = cipher;
  }

  read(server: string): string | null {
    const key = serverKey(server);
    const sealed = readOrNull(join(this.directory, `${key}.bin`));
    if (sealed !== null) {
      this.requireCipher();
      const value = this.cipher.decrypt(sealed);
      if (value === '') {
        throw new Error('配对凭证解不开或是空的，请重新配对这台电脑。');
      }
      return value;
    }
    const old = this.legacy === null ? null : readOrNull(join(this.legacy, key));
    if (old === null || old.length === 0) {
      return null;
    }
    const value = old.toString('utf8');
    this.save(server, value);
    return value;
  }

  save(server: string, credential: string): void {
    if (credential === '') {
      throw new Error('配对回答里没有凭证，请重新配对。');
    }
    this.requireCipher();
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const file = join(this.directory, `${serverKey(server)}.bin`);
    const temporary = `${file}.partial-${process.pid}`;
    writeFileSync(temporary, this.cipher.encrypt(credential), { mode: 0o600 });
    renameSync(temporary, file);
  }

  forget(server: string): void {
    rmSync(join(this.directory, `${serverKey(server)}.bin`), { force: true });
  }

  private requireCipher(): void {
    if (!this.cipher.available()) {
      throw new Error('系统钥匙串现在用不了，配对凭证没法加密保存。解锁钥匙串后再试。');
    }
  }
}
