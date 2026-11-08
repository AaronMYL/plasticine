// 自签证书：中继的主域名在 ACME 证书到手前先用一张顶着（进程能起来，浏览器会警告），本机演示和测试里的假实例也用它。
// Node 自己不会签证书；用 @peculiar/x509（acme-client 本来就带着它）加 WebCrypto 的 P-256。

import { webcrypto } from 'node:crypto';
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
// 起始时间往前拨一点：两台机器的钟差几分钟时证书不会「还没生效」。
const BACKDATE_MS = 5 * 60 * 1000;

export interface CertificatePair {
  /** PKCS#8 PEM。 */
  key: string;
  /** PEM，可能带中间证书链。 */
  cert: string;
}

function pem(label: string, der: ArrayBuffer): string {
  const body = Buffer.from(der).toString('base64').replace(/.{64}/g, '$&\n').replace(/\n$/, '');
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
}

/** 给这些名字签一张自签证书，`days` 天有效。第一个名字也写进 CN。 */
export async function selfSignedCertificate(hosts: readonly string[], days: number): Promise<CertificatePair> {
  cryptoProvider.set(webcrypto);
  const keys = await webcrypto.subtle.generateKey(ALGORITHM, true, ['sign', 'verify']);
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
      new SubjectAlternativeNameExtension(hosts.map((host) => ({ type: 'dns', value: host }))),
    ],
  });
  const key = await webcrypto.subtle.exportKey('pkcs8', keys.privateKey);
  return { key: pem('PRIVATE KEY', key), cert: certificate.toString('pem') };
}
