// SPDX-License-Identifier: Apache-2.0

import { X509Certificate } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createSecureContext, type SecureContext } from 'node:tls';
import type { CertificatePair } from './self-signed.ts';

const RENEW_FRACTION = 2 / 3;
const PRIVATE_FILE_MODE = 0o600;

export interface CertificateIssuer {
  issue(host: string): Promise<CertificatePair>;
}

export class ChallengeResponses {
  readonly #tokens = new Map<string, string>();

  set(token: string, keyAuthorization: string): void {
    this.#tokens.set(token, keyAuthorization);
  }

  delete(token: string): void {
    this.#tokens.delete(token);
  }

  get(token: string): string | undefined {
    return this.#tokens.get(token);
  }
}

export function renewAt(notBefore: Date, notAfter: Date): Date {
  return new Date(notBefore.getTime() + (notAfter.getTime() - notBefore.getTime()) * RENEW_FRACTION);
}

export async function writePrivateFile(path: string, content: string): Promise<void> {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, content, { mode: PRIVATE_FILE_MODE });
  await rename(temporary, path);
}

async function readIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw new Error(`读证书文件失败：${path}`, { cause: error });
  }
}

interface Loaded {
  pair: CertificatePair;
  context: SecureContext;
  renewAt: Date;
}

export interface CertificateKeeperOptions {
  directory: string;
  host: string;
  issuer: CertificateIssuer;
  now?: () => Date;
}

export class CertificateKeeper {
  readonly #options: CertificateKeeperOptions;
  readonly #now: () => Date;
  #loaded: Loaded | null = null;
  #issuing: Promise<boolean> | null = null;

  constructor(options: CertificateKeeperOptions) {
    this.#options = options;
    this.#now = options.now ?? (() => new Date());
  }

  get host(): string {
    return this.#options.host;
  }

  #paths(): { key: string; cert: string } {
    const base = join(this.#options.directory, this.#options.host);
    return { key: `${base}.key.pem`, cert: `${base}.cert.pem` };
  }

  #use(pair: CertificatePair): void {
    const parsed = new X509Certificate(pair.cert);
    this.#loaded = {
      pair,
      context: createSecureContext({ key: pair.key, cert: pair.cert }),
      renewAt: renewAt(new Date(parsed.validFrom), new Date(parsed.validTo)),
    };
  }

  async load(): Promise<boolean> {
    const paths = this.#paths();
    const [key, cert] = await Promise.all([readIfPresent(paths.key), readIfPresent(paths.cert)]);
    if (key === null || cert === null) {
      return false;
    }
    this.#use({ key, cert });
    return true;
  }

  context(): SecureContext | null {
    return this.#loaded?.context ?? null;
  }

  dueAt(): Date {
    return this.#loaded?.renewAt ?? this.#now();
  }

  ensure(): Promise<boolean> {
    if (this.#loaded !== null && this.#now() < this.#loaded.renewAt) {
      return Promise.resolve(false);
    }
    this.#issuing ??= this.#issue().finally(() => {
      this.#issuing = null;
    });
    return this.#issuing;
  }

  async #issue(): Promise<boolean> {
    const pair = await this.#options.issuer.issue(this.#options.host);
    const paths = this.#paths();
    await mkdir(this.#options.directory, { recursive: true, mode: 0o700 });
    await writePrivateFile(paths.key, pair.key);
    await writePrivateFile(paths.cert, pair.cert);
    this.#use(pair);
    return true;
  }
}
