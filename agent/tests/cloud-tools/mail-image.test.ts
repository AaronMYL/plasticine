import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { MailImageError, MailImageFetcher } from '../../src/cloud-tools/mail-image-fetch.ts';
import { MailImageSigner } from '../../src/cloud-tools/mail-image-signer.ts';
import { isPrivateHost } from '../../src/cloud-tools/urls.ts';

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'plasticine-mail-image-'));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

function query(url: string): { u: string; e: string; s: string } {
  const params = new URL(url, 'http://local.test').searchParams;
  return { u: params.get('u') ?? '', e: params.get('e') ?? '', s: params.get('s') ?? '' };
}

test('image proxy signature binds URL+expiry, rejects tampered/expired, 0600 key survives restart', () => {
  let now = new Date('2026-11-04T10:00:00.000Z');
  const signer = new MailImageSigner(directory, () => now);
  const target = 'https://img.example.test/logo.png?a=1&b=2';
  const signed = signer.url(target);
  assert.match(signed, /^\/v2\/mail-image\?u=https%3A%2F%2Fimg\.example\.test%2Flogo\.png%3Fa%3D1%26b%3D2&e=\d+&s=/);
  const { u, e, s } = query(signed);
  assert.equal(u, target);
  assert.equal(signer.check(u, e, s), 'ok');
  assert.equal(signer.check('https://img.example.test/other.png', e, s), 'invalid');
  assert.equal(signer.check(u, String(Number(e) + 3600), s), 'invalid');
  assert.equal(signer.check(u, e, `${s.slice(0, -1)}${s.endsWith('A') ? 'B' : 'A'}`), 'invalid');
  assert.equal(new MailImageSigner(directory, () => now).check(u, e, s), 'ok');
  if (process.platform !== 'win32') {
    assert.equal(statSync(join(directory, 'mail-image.key')).mode & 0o777, 0o600);
  }
  assert.equal(signer.url(target), signed);
  now = new Date(Number(e) * 1000 + 1);
  assert.equal(signer.check(u, e, s), 'expired');
  const other = mkdtempSync(join(tmpdir(), 'plasticine-mail-image-other-'));
  try {
    assert.equal(new MailImageSigner(other, () => new Date('2026-11-04T10:00:00.000Z')).check(u, e, s), 'invalid');
  } finally {
    rmSync(other, { recursive: true, force: true });
  }
});

interface Served {
  server: Server;
  port: number;
  hits: IncomingHttpHeaders[];
}

async function imageServer(): Promise<Served> {
  const hits: IncomingHttpHeaders[] = [];
  const server = createServer((req, res) => {
    hits.push(req.headers);
    if (req.url === '/logo.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(Buffer.from('89504e47', 'hex'));
    } else if (req.url === '/page') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<script>alert(1)</script>');
    } else if (req.url === '/vector.svg') {
      res.writeHead(200, { 'content-type': 'image/svg+xml' });
      res.end('<svg onload="alert(1)"/>');
    } else if (req.url === '/huge.png') {
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(6 * 1024 * 1024) });
      res.end();
    } else if (req.url === '/hop') {
      res.writeHead(302, { location: '/logo.png' });
      res.end();
    } else if (req.url === '/inside') {
      res.writeHead(302, { location: 'http://inside.test/secret.png' });
      res.end();
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address !== 'string');
  return { server, port: address.port, hits };
}

function fetcher(): MailImageFetcher {
  const table: Record<string, string> = { 'img.test': '127.0.0.1', 'meta.test': '169.254.169.254',
    'inside.test': '10.1.2.3', 'v6.test': 'fd00::1' };
  return new MailImageFetcher({
    resolve: async (host) => {
      const address = table[host] ?? host;
      return [{ address, family: address.includes(':') ? 6 : 4 }];
    },
    blocked: (address) => address !== '127.0.0.1' && isPrivateHost(address),
  });
}

async function refused(work: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(work, (error: unknown) => error instanceof MailImageError && error.code === code);
}

test('image fetch follows redirects without Referer/cookie and caches repeated fetches', async () => {
  const served = await imageServer();
  const images = fetcher();
  try {
    const signal = AbortSignal.timeout(5_000);
    const first = await images.get(`http://img.test:${served.port}/logo.png`, signal);
    assert.equal(first.type, 'image/png');
    assert.deepEqual(first.data, Buffer.from('89504e47', 'hex'));
    await images.get(`http://img.test:${served.port}/logo.png`, signal);
    assert.equal(served.hits.length, 1);
    const hopped = await images.get(`http://img.test:${served.port}/hop`, signal);
    assert.equal(hopped.type, 'image/png');
    for (const headers of served.hits) {
      assert.equal(headers.referer, undefined);
      assert.equal(headers.cookie, undefined);
      assert.match(headers['user-agent'] ?? '', /PlasticineMailImage/);
      assert.match(headers.host ?? '', /^img\.test:/);
    }
  } finally {
    served.server.close();
  }
});

test('image fetch blocks private/metadata/localhost, private redirect, non-http(s), SVG, oversized', async () => {
  const served = await imageServer();
  const images = fetcher();
  const signal = AbortSignal.timeout(5_000);
  try {
    await refused(images.get('http://meta.test/latest/meta-data/', signal), 'refused');
    await refused(images.get('http://inside.test/x.png', signal), 'refused');
    await refused(images.get('http://v6.test/x.png', signal), 'refused');
    await refused(images.get('http://10.0.0.1/x.png', signal), 'refused');
    await refused(images.get('http://localhost/x.png', signal), 'refused');
    await refused(images.get('http://printer.local/x.png', signal), 'refused');
    await refused(images.get(`http://img.test:${served.port}/inside`, signal), 'refused');
    await refused(images.get('file:///etc/passwd', signal), 'refused');
    await refused(images.get('ftp://img.test/x.png', signal), 'refused');
    await refused(images.get('http://user:pw@img.test/x.png', signal), 'refused');
    await refused(images.get(`http://img.test:${served.port}/page`, signal), 'not_image');
    await refused(images.get(`http://img.test:${served.port}/vector.svg`, signal), 'not_image');
    await refused(images.get(`http://img.test:${served.port}/huge.png`, signal), 'too_large');
    await refused(images.get(`http://img.test:${served.port}/missing.png`, signal), 'failed');
    assert.ok(served.hits.every((headers) => !/inside/.test(headers.host ?? '')));
  } finally {
    served.server.close();
  }
});
