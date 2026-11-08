// 证书：实例和中继各自用 HTTP-01 拿 ACME 证书，钥匙和证书存在自己的状态目录，用到三分之二寿命时续。签发由
// acme-client 做，这里测我们这一层：什么时候续、存哪、读回来能不能起 TLS、ACME 验证用的应答怎么挂上去和撤掉。

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { X509Certificate } from 'node:crypto';
import {
  CertificateKeeper,
  ChallengeResponses,
  createAcmeIssuer,
  renewAt,
  selfSignedCertificate,
  type AcmeClientLike,
  type CertificateIssuer,
} from '../../src/network/index.ts';

let directory: string;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'plasticine-certs-'));
});

after(async () => {
  await rm(directory, { recursive: true, force: true });
});

const DAY = 24 * 60 * 60 * 1000;

/** 假的签发方：每次签一张 90 天的自签证书，数签了几次。 */
function issuer(): CertificateIssuer & { issued: number } {
  return {
    issued: 0,
    async issue(host) {
      this.issued += 1;
      return selfSignedCertificate([host], 90);
    },
  };
}

test('续期时刻：寿命的三分之二（90 天的证书第 60 天）', () => {
  const from = new Date('2026-11-01T00:00:00Z');
  const to = new Date(from.getTime() + 90 * DAY);
  assert.equal(renewAt(from, to).toISOString(), '2026-12-31T00:00:00.000Z');
});

test('自签证书：名字在 SAN 里，有效期照给的天数', async () => {
  const pair = await selfSignedCertificate(['a.localtest', 'localtest'], 3);
  const cert = new X509Certificate(pair.cert);
  assert.match(cert.subjectAltName ?? '', /DNS:a\.localtest/);
  assert.match(cert.subjectAltName ?? '', /DNS:localtest/);
  const lifetime = Date.parse(cert.validTo) - Date.parse(cert.validFrom);
  assert.ok(Math.abs(lifetime - 3 * DAY) <= 10 * 60 * 1000);
  assert.ok(cert.checkPrivateKey((await import('node:crypto')).createPrivateKey(pair.key)));
});

test('没有证书：签一张存下（钥匙只有本人可读），读回来能起 TLS；还新就不再签', async () => {
  const fake = issuer();
  let now = new Date();
  const keeper = new CertificateKeeper({ directory, host: 'xiaoyu.localtest', issuer: fake, now: () => now });
  assert.equal(await keeper.load(), false);
  assert.equal(keeper.context(), null);
  assert.equal(await keeper.ensure(), true);
  assert.equal(fake.issued, 1);
  assert.notEqual(keeper.context(), null);
  const keyFile = join(directory, 'xiaoyu.localtest.key.pem');
  assert.equal((await stat(keyFile)).mode & 0o777, 0o600);
  assert.match(await readFile(join(directory, 'xiaoyu.localtest.cert.pem'), 'utf8'), /BEGIN CERTIFICATE/);
  assert.equal(await keeper.ensure(), false);
  // 重开一个（进程重启）：从盘上读回来，不重签。
  const again = new CertificateKeeper({ directory, host: 'xiaoyu.localtest', issuer: fake, now: () => now });
  assert.equal(await again.load(), true);
  assert.equal(await again.ensure(), false);
  assert.equal(fake.issued, 1);
  // 过了三分之二寿命：续。
  now = new Date(now.getTime() + 61 * DAY);
  assert.equal(await again.ensure(), true);
  assert.equal(fake.issued, 2);
});

test('签发失败：原来的证书照用，错误带出去给调用方记', async () => {
  const failing: CertificateIssuer = { issue: () => Promise.reject(new Error('ACME 拒了')) };
  const keeper = new CertificateKeeper({ directory, host: 'broken.localtest', issuer: failing });
  await assert.rejects(keeper.ensure(), /ACME 拒了/);
  assert.equal(keeper.context(), null);
});

test('ACME 签发：账号钥匙存一次复用；HTTP-01 应答签发时挂上、完了撤掉；CSR 里是这个名字', async () => {
  const challenges = new ChallengeResponses();
  const seen: { token: string; during: string | undefined }[] = [];
  const accountKeys: string[] = [];
  const client = (options: { accountKey: string }): AcmeClientLike => {
    accountKeys.push(options.accountKey);
    return {
      async auto(auto) {
        assert.deepEqual(auto.challengePriority, ['http-01']);
        assert.equal(auto.termsOfServiceAgreed, true);
        const challenge = { type: 'http-01', token: 'tok-123', url: 'https://acme.test/c', status: 'pending' };
        await auto.challengeCreateFn({}, challenge, 'tok-123.thumb');
        seen.push({ token: challenge.token, during: challenges.get('tok-123') });
        await auto.challengeRemoveFn({}, challenge, 'tok-123.thumb');
        const csr = auto.csr.toString();
        assert.match(csr, /BEGIN CERTIFICATE REQUEST/);
        return (await selfSignedCertificate(['xiaoyu.localtest'], 90)).cert;
      },
    };
  };
  const acme = createAcmeIssuer({ directoryUrl: 'https://acme.test/directory', accountKeyFile: join(directory,
    'acme-account.key.pem'), challenges, client });
  const issued = await acme.issue('xiaoyu.localtest');
  assert.match(issued.cert, /BEGIN CERTIFICATE/);
  assert.match(issued.key, /PRIVATE KEY/);
  assert.deepEqual(seen, [{ token: 'tok-123', during: 'tok-123.thumb' }]);
  assert.equal(challenges.get('tok-123'), undefined);
  await acme.issue('xiaoyu.localtest');
  assert.equal(accountKeys.length, 2);
  assert.equal(accountKeys[0], accountKeys[1]);
  assert.equal((await stat(join(directory, 'acme-account.key.pem'))).mode & 0o777, 0o600);
});
