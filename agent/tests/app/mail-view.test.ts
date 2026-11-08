// 邮件按原样显示的接口：聊天里邮件一项标题和正文分开给；点开取正文时 HTML 再清洗一遍，cid: 换成 data:、远程图换成签名
// 代理地址；只有纯文字的信 html 是 null；别的联系人的信 404。图片代理不要会话、凭签名：签名不对或过期 403，指向内网的
// 502，正常的回图片字节（不执行、不带来源）。

import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { isPrivateHost } from '../../src/cloud-tools/urls.ts';
import { call, json, pair, startTestApp, type TestApp } from './helpers.ts';

const opened: TestApp[] = [];

afterEach(async () => {
  for (const started of opened.splice(0)) {
    await started.close();
  }
});

async function app(): Promise<TestApp> {
  const table: Record<string, string> = { 'img.test': '127.0.0.1', 'meta.test': '169.254.169.254' };
  const started = await startTestApp([], { startTasks: false, mailImages: {
    resolve: async (host) => [{ address: table[host] ?? host, family: 4 }],
    blocked: (address) => address !== '127.0.0.1' && isPrivateHost(address),
  } });
  opened.push(started);
  return started;
}

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
type Body = Record<string, unknown>;

function seed(t: TestApp, port: number) {
  const now = t.clock.now().toISOString();
  const rich = t.state.inboxMessages.add({ source: 'email', fromAddress: 'news@example.test', fromName: '周报',
    title: '本周精选', body: '你好\n\n第二段', receivedAt: now, messageId: '<rich@example.test>',
    attachments: ['报价.pdf'],
    bodyHtml: `<p>你好 <img src="cid:logo@x" alt="标志"></p><p><img src="http://img.test:${port}/a.png"></p>`
      + '<p onclick="x()">第二段</p>' }).message;
  mkdirSync(join(t.directory, 'mail', 'parts', rich.id), { recursive: true });
  writeFileSync(join(t.directory, 'mail', 'parts', rich.id, '0'), PNG);
  t.state.inboxMailParts.add({ messageId: rich.id, contentId: 'logo@x', filename: 'logo.png', type: 'image/png',
    size: PNG.length, path: `mail/parts/${rich.id}/0` });
  const plain = t.state.inboxMessages.add({ source: 'email', fromAddress: 'news@example.test', fromName: '周报',
    title: '只有文字', body: '第一行\nhttps://example.test/a', receivedAt: now, messageId: '<plain@example.test>' })
    .message;
  const other = t.state.inboxMessages.add({ source: 'email', fromAddress: 'other@example.test', title: '别人的',
    body: '正文', receivedAt: now, messageId: '<other@example.test>' }).message;
  return { rich, plain, other };
}

test('聊天里的邮件标题和正文分开给；点开的正文 HTML 再清洗、cid 换 data:、远程图换签名代理；纯文字的 html 是 null',
  async () => {
    const t = await app();
    const cookie = await pair(t);
    const { rich, plain, other } = seed(t, 9);
    const contact = encodeURIComponent('mail:news@example.test');
    const items = json(await call(t, 'GET', `/v2/contacts/${contact}/messages`, { cookie }))['items'] as Body[];
    const views = items.map((item) => item['message'] as Body);
    const richView = views.find((view) => view['id'] === rich.id) as Body;
    assert.equal(richView['text'], '你好\n\n第二段');
    assert.deepEqual(richView['mail'], { subject: '本周精选', fromName: '周报', fromAddress: 'news@example.test',
      html: true, attachments: ['报价.pdf'] });
    assert.equal((views.find((view) => view['id'] === plain.id)?.['mail'] as Body)['html'], false);

    const body = json(await call(t, 'GET', `/v2/contacts/${contact}/mail/${rich.id}`, { cookie }));
    const html = String(body['html']);
    assert.match(html, /<img src="data:image\/png;base64,iVBORw0KGgo=" alt="标志">/);
    assert.match(html, /<img src="\/v2\/mail-image\?u=http%3A%2F%2Fimg\.test%3A9%2Fa\.png&amp;e=\d+&amp;s=[\w-]{43}">/);
    assert.doesNotMatch(html, /onclick|cid:/);
    assert.equal(body['subject'], '本周精选');
    assert.equal(body['text'], '你好\n\n第二段');
    const plainBody = json(await call(t, 'GET', `/v2/contacts/${contact}/mail/${plain.id}`, { cookie }));
    assert.equal(plainBody['html'], null);
    assert.equal(plainBody['text'], '第一行\nhttps://example.test/a');
    assert.equal((await call(t, 'GET', `/v2/contacts/${contact}/mail/${other.id}`, { cookie })).status, 404);
    assert.equal((await call(t, 'GET', `/v2/contacts/${contact}/mail/${rich.id}`)).status, 401);
  });

test('图片代理：不要会话、凭签名；签名不对或过期 403，指向内网 502，正常回图片字节且不执行', async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end(PNG);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address !== 'string');
  try {
    const t = await app();
    const cookie = await pair(t);
    const { rich } = seed(t, address.port);
    const contact = encodeURIComponent('mail:news@example.test');
    const html = String(json(await call(t, 'GET', `/v2/contacts/${contact}/mail/${rich.id}`, { cookie }))['html']);
    const proxied = /src="(\/v2\/mail-image\?[^"]+)"/.exec(html)?.[1]?.replaceAll('&amp;', '&') ?? '';
    const image = await call(t, 'GET', proxied);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.equal(image.headers.get('content-security-policy'), "default-src 'none'; sandbox");
    assert.equal(image.headers.get('referrer-policy'), 'no-referrer');
    assert.deepEqual(Buffer.from(image.body as ArrayBuffer), PNG);

    const tampered = proxied.replace(/u=[^&]+/, `u=${encodeURIComponent('http://meta.test/latest/')}`);
    assert.equal((await call(t, 'GET', tampered)).status, 403);
    const signer = t.app.deps.m5b.mailImages.signer;
    const inside = await call(t, 'GET', signer.url('http://meta.test/latest/meta-data/'));
    assert.equal(inside.status, 502);
    assert.equal(json(inside)['code'], 'upstream_failed');
    t.clock.advance(25 * 60 * 60 * 1000);
    const expired = await call(t, 'GET', proxied);
    assert.equal(expired.status, 403);
    assert.equal(json(expired)['code'], 'signature_expired');
  } finally {
    server.close();
  }
});
