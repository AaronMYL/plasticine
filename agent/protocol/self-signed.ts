// SPDX-License-Identifier: Apache-2.0

import {
  BasicConstraintsExtension,
  cryptoProvider,
  ExtendedKeyUsage,
  ExtendedKeyUsageExtension,
  SubjectAlternativeNameExtension,
  X509CertificateGenerator,
} from '@peculiar/x509';

const ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' } as const;
const DAY_MS = 24 * 60 * 60 * 1000;
const BACKDATE_MS = 5 * 60 * 1000;

export interface CertificatePair {
  key: string;
  cert: string;
}

function pem(label: string, der: ArrayBuffer): string {
  const body = Buffer.from(der).toString('base64').replace(/.{64}/g, '$&\n').replace(/\n$/, '');
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
}

const webcrypto = globalThis.crypto;

export async function selfSignedCertificate(hosts: readonly string[], days: number): Promise<CertificatePair> {
  cryptoProvider.set(webcrypto);
  const keys = await webcrypto.subtle.generateKey(ALGORITHM, true, ['sign', 'verify']);
  if (!('privateKey' in keys)) {
    throw new Error('生成证书钥匙时没拿到一对公私钥');
  }
  const notBefore = new Date(Date.now() - BACKDATE_MS);
  const certificate = await X509CertificateGenerator.createSelfSigned({
    serialNumber: Buffer.from(webcrypto.getRandomValues(new Uint8Array(8))).toString('hex').replace(/^[89a-f]/, '1'),
    name: `CN=${hosts[0] ?? 'localhost'}`,
    notBefore,
    notAfter: new Date(notBefore.getTime() + BACKDATE_MS + days * DAY_MS),
    keys,
    signingAlgorithm: ALGORITHM,
    extensions: [
      new BasicConstraintsExtension(false, undefined, true),
      new ExtendedKeyUsageExtension([ExtendedKeyUsage.serverAuth]),
      new SubjectAlternativeNameExtension(hosts.map((host) => ({ type: 'dns' as const, value: host }))),
    ],
  });
  const key = await webcrypto.subtle.exportKey('pkcs8', keys.privateKey);
  return { key: pem('PRIVATE KEY', key), cert: certificate.toString('pem') };
}
