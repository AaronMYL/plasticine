// SPDX-License-Identifier: Apache-2.0

import { Client, crypto as acmeCrypto } from 'acme-client';
import { readFile } from 'node:fs/promises';
import { writePrivateFile, type CertificateIssuer, type ChallengeResponses } from './certificates.ts';
import type { CertificatePair } from './self-signed.ts';

export const LETS_ENCRYPT_DIRECTORY = 'https://acme-v02.api.letsencrypt.org/directory';

interface AcmeChallenge {
  type: string;
  token: string;
}

export interface AcmeAutoOptions {
  csr: Buffer;
  email?: string;
  termsOfServiceAgreed: boolean;
  skipChallengeVerification: boolean;
  challengePriority: string[];
  challengeCreateFn: (authz: unknown, challenge: AcmeChallenge, keyAuthorization: string) => Promise<void>;
  challengeRemoveFn: (authz: unknown, challenge: AcmeChallenge, keyAuthorization: string) => Promise<void>;
}

export interface AcmeClientLike {
  auto(options: AcmeAutoOptions): Promise<string>;
}

export interface AcmeIssuerOptions {
  directoryUrl: string;
  accountKeyFile: string;
  challenges: ChallengeResponses;
  email?: string;
  client?: (options: { directoryUrl: string; accountKey: string }) => AcmeClientLike;
}

function realClient(options: { directoryUrl: string; accountKey: string }): AcmeClientLike {
  return new Client(options);
}

async function accountKey(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      throw new Error('读 ACME 账号钥匙失败', { cause: error });
    }
  }
  const created = (await acmeCrypto.createPrivateEcdsaKey()).toString();
  await writePrivateFile(path, created);
  return created;
}

export function createAcmeIssuer(options: AcmeIssuerOptions): CertificateIssuer {
  const makeClient = options.client ?? realClient;
  return {
    async issue(host: string): Promise<CertificatePair> {
      const client = makeClient({ directoryUrl: options.directoryUrl, accountKey: await accountKey(
        options.accountKeyFile) });
      const [key, csr] = await acmeCrypto.createCsr({ commonName: host, altNames: [host] },
        await acmeCrypto.createPrivateEcdsaKey());
      const cert = await client.auto({
        csr,
        ...(options.email === undefined ? {} : { email: options.email }),
        termsOfServiceAgreed: true,
        skipChallengeVerification: true,
        challengePriority: ['http-01'],
        challengeCreateFn: async (_authz, challenge, keyAuthorization) => {
          options.challenges.set(challenge.token, keyAuthorization);
        },
        challengeRemoveFn: async (_authz, challenge) => {
          options.challenges.delete(challenge.token);
        },
      });
      return { key: key.toString(), cert };
    },
  };
}
