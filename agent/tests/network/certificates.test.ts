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

function issuer(): CertificateIssuer & { issued: number } {
  return {
    issued: 0,
    async issue(host) {
      this.issued += 1;
      return selfSignedCertificate([host], 90);
    },
  };
}

test('Cert renewal triggers at two-thirds lifetime (day 60 of 90-day cert)', () => {
  const from = new Date('2026-11-01T00:00:00Z');
  const to = new Date(from.getTime() + 90 * DAY);
  assert.equal(renewAt(from, to).toISOString(), '2026-12-31T00:00:00.000Z');
});

test('Self-signed cert includes hostname in SAN and honors requested validity days', async () => {
  const pair = await selfSignedCertificate(['a.localtest', 'localtest'], 3);
  const cert = new X509Certificate(pair.cert);
  assert.match(cert.subjectAltName ?? '', /DNS:a\.localtest/);
  assert.match(cert.subjectAltName ?? '', /DNS:localtest/);
  const lifetime = Date.parse(cert.validTo) - Date.parse(cert.validFrom);
  assert.ok(Math.abs(lifetime - 3 * DAY) <= 10 * 60 * 1000);
  assert.ok(cert.checkPrivateKey((await import('node:crypto')).createPrivateKey(pair.key)));
});

test('Issues and saves TLS cert with owner-only key when missing; skips if still fresh', async () => {
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
  const again = new CertificateKeeper({ directory, host: 'xiaoyu.localtest', issuer: fake, now: () => now });
  assert.equal(await again.load(), true);
  assert.equal(await again.ensure(), false);
  assert.equal(fake.issued, 1);
  now = new Date(now.getTime() + 61 * DAY);
  assert.equal(await again.ensure(), true);
  assert.equal(fake.issued, 2);
});

test('Cert issuance failure keeps existing cert and surfaces error to caller', async () => {
  const failing: CertificateIssuer = { issue: () => Promise.reject(new Error('ACME 拒了')) };
  const keeper = new CertificateKeeper({ directory, host: 'broken.localtest', issuer: failing });
  await assert.rejects(keeper.ensure(), /ACME 拒了/);
  assert.equal(keeper.context(), null);
});

test('ACME reuses saved account key, mounts/removes HTTP-01 challenge, sets CSR host', async () => {
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
