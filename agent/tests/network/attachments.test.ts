import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { afterEach, test } from 'node:test';
import { Value } from 'typebox/value';
import { generateIdentityKeys, openEnvelope } from '../../src/network/index.ts';
import { signedHeaders } from '../../protocol/relay-client.ts';
import { NET_HEADERS, type Envelope } from '../../shared/net-wire.ts';
import { NetworkAttachmentMetaSchema, NETWORK_ATTACHMENT_MAX_BYTES } from '../../shared/network-attachments.ts';
import { call, json, pair, startTestApp, type TestApp } from '../app/helpers.ts';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/f1sAAAAASUVORK5CYII=';
const opened: TestApp[] = [];
afterEach(async () => { for (const app of opened.splice(0)) await app.close(); });
const hash = (data: Buffer): string => createHash('sha256').update(data).digest('hex');

async function peers() {
  const envelopes: Envelope[] = [];
  const apps = new Map<string, TestApp>();
  let offline = false;
  let tamper = false;
  const peerFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const app = apps.get(url.hostname);
    if (app !== undefined) {
      if (offline) throw new Error('fixture-peer-offline');
      const response = await fetch(`${app.base}${url.pathname}`, init);
      if (!tamper || !response.ok) return response;
      const body = await response.json() as Envelope;
      return Response.json({ ...body, signature: 'a'.repeat(86) });
    }
    if (url.pathname.endsWith('/envelopes/ack')) return Response.json({ acked: 1 });
    if (url.pathname.endsWith('/envelopes') && init?.method === 'POST') {
      envelopes.push(JSON.parse(String(init.body)) as Envelope);
      return Response.json({ accepted: true });
    }
    if (url.pathname.endsWith('/envelopes')) {
      const account = new Headers(init?.headers).get(NET_HEADERS.account);
      return Response.json({ envelopes: envelopes.filter((item) => item.to === account), cursor: '1' });
    }
    throw new Error(`unexpected fixture path: ${url.pathname}`);
  };
  const make = async (handle: string) => {
    const app = await startTestApp([], { startTasks: false, network: { fetch: peerFetch } });
    opened.push(app);
    const keys = generateIdentityKeys();
    const identity = app.state.networkIdentity.create({ accountId: `acct-${handle}`, handle,
      displayName: handle, relayUrl: 'https://relay.example.test', joinedAt: app.clock.now().toISOString(),
      signingPublicKey: keys.signing.publicKey, signingPrivateKey: keys.signing.privateKey,
      encryptionPublicKey: keys.encryption.publicKey, encryptionPrivateKey: keys.encryption.privateKey });
    apps.set(`${handle}.relay.example.test`, app);
    return { app, identity, cookie: await pair(app) };
  };
  const a = await make('fernfixture');
  const b = await make('riverfixture');
  const connect = (owner: typeof a, peer: typeof a) => owner.app.state.contacts.create({
    accountId: peer.identity.accountId, handle: peer.identity.handle, displayName: peer.identity.displayName,
    signingKey: peer.identity.signingPublicKey, encryptionKey: peer.identity.encryptionPublicKey,
    state: 'active', lastAt: owner.app.clock.now().toISOString(),
  });
  const ab = connect(a, b), ba = connect(b, a);
  return { a, b, ab, ba, envelopes, setOffline(value: boolean) { offline = value; },
    setTamper(value: boolean) { tamper = value; } };
}

async function upload(app: TestApp, cookie: string, data = Buffer.from('fixture attachment'), name = 'note.txt') {
  const response = await call(app, 'POST', '/v2/network/attachments', { cookie, body: {
    requestId: `upload-${name}`, name, mimeType: name.endsWith('.png') ? 'image/png' : 'text/plain',
    bytes: data.length, sha256: hash(data), content: data.toString('base64'),
  } });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return json(response)['id'] as string;
}

async function deliver(pair: Awaited<ReturnType<typeof peers>>, ids: string[]) {
  const { a, b, ab } = pair;
  const sent = await call(a.app, 'POST', `/v2/contacts/${ab.id}/messages`, { cookie: a.cookie,
    body: { requestId: 'send-attachments', text: '', attachmentIds: ids } });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  await a.app.app.deps.network.flushOutbox();
  await b.app.app.deps.network.syncOnce();
  return json(sent)['message'] as Record<string, unknown>;
}

test('联系人附件仅发送元数据；两端取回原件，验签解密、大小和摘要都一致', async () => {
  const p = await peers();
  const data = Buffer.from('fictional private attachment');
  const id = await upload(p.a.app, p.a.cookie, data);
  const sent = await deliver(p, [id]);
  const outgoing = p.envelopes.find((item) => item.kind === 'text')!;
  const clear = openEnvelope(outgoing, p.a.identity.signingPublicKey, p.b.identity.encryptionPrivateKey);
  assert.ok(clear.ok);
  assert.equal(JSON.stringify(clear).includes(data.toString('base64')), false);
  const received = p.b.app.state.contactMessages.recent(p.ba.id, 10).find((item) => item.kind === 'text')!;
  const view = json(await call(p.b.app, 'GET', `/v2/contacts/${p.ba.id}/messages`, { cookie: p.b.cookie }));
  const message = (view['items'] as { message: { attachments: { id: string; sha256: string }[] } }[])
    .find((item) => item.message?.attachments?.length === 1)!.message;
  assert.equal(message.attachments[0]!.sha256, hash(data));
  const content = await fetch(`${p.b.app.base}/v2/contacts/${p.ba.id}/messages/${received.id}`
    + `/attachments/${message.attachments[0]!.id}/content`, { headers: { cookie: p.b.cookie } });
  assert.equal(content.status, 200);
  assert.deepEqual(Buffer.from(await content.arrayBuffer()), data);
  assert.equal((sent['attachments'] as unknown[]).length, 1);
});

test('对方离线先保留消息和附件元数据；恢复后同一附件可重试读取', async () => {
  const p = await peers();
  const id = await upload(p.a.app, p.a.cookie);
  p.setOffline(true);
  await deliver(p, [id]);
  const message = p.b.app.state.contactMessages.recent(p.ba.id, 10).find((item) => item.kind === 'text')!;
  const rows = p.b.app.state.networkAttachments.forMessage(message.id);
  const path = `/v2/contacts/${p.ba.id}/messages/${message.id}/attachments/${rows[0]!.id}/content`;
  assert.equal((await call(p.b.app, 'GET', path, { cookie: p.b.cookie })).status, 502);
  p.setOffline(false);
  assert.equal((await call(p.b.app, 'GET', path, { cookie: p.b.cookie })).status, 200);
  assert.equal(p.b.app.state.networkAttachments.forMessage(message.id).length, 1);
});

test('peer取原件验证身份、时钟和nonce；转给名单外的人或另一段对话都拒绝', async () => {
  const p = await peers();
  const id = await upload(p.a.app, p.a.cookie);
  await deliver(p, [id]);
  const path = `/v2/net/attachments/${id}`;
  const headers = signedHeaders({ accountId: p.b.identity.accountId,
    signingPrivateKey: p.b.identity.signingPrivateKey }, 'GET', path, Buffer.alloc(0), p.a.app.clock.now());
  const first = await fetch(`${p.a.app.base}${path}`, { headers });
  assert.equal(first.status, 200);
  const encrypted = await first.json() as Envelope;
  assert.equal(encrypted.to, p.b.identity.accountId);
  assert.ok(openEnvelope(encrypted, p.a.identity.signingPublicKey, p.b.identity.encryptionPrivateKey).ok);
  assert.equal((await fetch(`${p.a.app.base}${path}`, { headers })).status, 403);
  assert.equal((await fetch(`${p.a.app.base}${path}`)).status, 403);
  const stale = signedHeaders({ accountId: p.b.identity.accountId,
    signingPrivateKey: p.b.identity.signingPrivateKey }, 'GET', path, Buffer.alloc(0),
  new Date(p.a.app.clock.now().getTime() - 6 * 60_000));
  assert.equal((await fetch(`${p.a.app.base}${path}`, { headers: stale })).status, 403);
  const fakeKeys = generateIdentityKeys();
  const stranger = p.a.app.state.contacts.create({ accountId: 'acct-outsider', handle: 'outsider',
    displayName: '测试旁观者', signingKey: fakeKeys.signing.publicKey,
    encryptionKey: fakeKeys.encryption.publicKey, state: 'active', lastAt: p.a.app.clock.now().toISOString() });
  const outside = signedHeaders({ accountId: stranger.accountId, signingPrivateKey: fakeKeys.signing.privateKey },
    'GET', path, Buffer.alloc(0), p.a.app.clock.now());
  assert.equal((await fetch(`${p.a.app.base}${path}`, { headers: outside })).status, 403);
});

test('附件最大25MB、缩略图最大512px；空消息没有附件不能发送', async () => {
  assert.equal(Value.Check(NetworkAttachmentMetaSchema, { id: 'fixture-file', name: 'sample.bin',
    mimeType: 'application/octet-stream', bytes: NETWORK_ATTACHMENT_MAX_BYTES + 1, sha256: 'a'.repeat(64) }), false);
  assert.equal(Value.Check(NetworkAttachmentMetaSchema, { id: 'fixture-file', name: 'sample.png',
    mimeType: 'image/png', bytes: 100, sha256: 'a'.repeat(64), thumbnail: { mimeType: 'image/png',
      width: 513, height: 512, content: 'YWJj' } }), false);
  const p = await peers();
  const oversized = await call(p.a.app, 'POST', '/v2/network/attachments', { cookie: p.a.cookie, body: {
    requestId: 'upload-too-large', name: 'sample.bin', mimeType: 'application/octet-stream',
    bytes: NETWORK_ATTACHMENT_MAX_BYTES + 1, sha256: 'a'.repeat(64), content: 'YQ==',
  } });
  assert.equal(oversized.status, 400);
  const empty = await call(p.a.app, 'POST', `/v2/contacts/${p.ab.id}/messages`, { cookie: p.a.cookie,
    body: { requestId: 'empty-message', text: '' } });
  assert.equal(empty.status, 400);
});


test('群组图片和文件使用同一消息关系；伪造密文不缓存，安全重试后原件一致', async () => {
  const p = await peers();
  const group = p.a.app.app.deps.network.createGroup({ name: '测试工作室', memberIds: [p.ab.id],
    requestId: 'group-attachments' });
  await p.a.app.app.deps.network.flushOutbox();
  await p.b.app.app.deps.network.syncOnce();
  const image = Buffer.from(PNG, 'base64');
  const ids = [await upload(p.a.app, p.a.cookie, image, 'pixel.png'), await upload(p.a.app, p.a.cookie)];
  const body = { requestId: 'group-send-media', text: '', attachmentIds: ids };
  const first = await call(p.a.app, 'POST', `/v2/contacts/${group.id}/messages`, { cookie: p.a.cookie, body });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const repeated = await call(p.a.app, 'POST', `/v2/contacts/${group.id}/messages`, { cookie: p.a.cookie, body });
  assert.deepEqual(repeated.body, first.body);
  await p.a.app.app.deps.network.flushOutbox();
  await p.b.app.app.deps.network.syncOnce();
  const message = p.b.app.state.groupMessages.recent(group.id, 10).find((row) => row.kind === 'text')!;
  const media = p.b.app.state.networkAttachments.forMessage(message.id);
  assert.equal(media.length, 2);
  p.setTamper(true);
  const path = `/v2/contacts/${group.id}/messages/${message.id}/attachments/${media[0]!.id}/content`;
  assert.equal((await call(p.b.app, 'GET', path, { cookie: p.b.cookie })).status, 502);
  assert.equal(p.b.app.state.networkAttachments.bytes(media[0]!.id), null);
  p.setTamper(false);
  const received = await fetch(`${p.b.app.base}${path}`, { headers: { cookie: p.b.cookie } });
  assert.deepEqual(Buffer.from(await received.arrayBuffer()), image);
  const wrong = `/v2/contacts/${p.ba.id}/messages/${message.id}/attachments/${media[0]!.id}/content`;
  assert.equal((await call(p.b.app, 'GET', wrong, { cookie: p.b.cookie })).status, 404);
  assert.equal(p.b.app.state.attachments.get(media[0]!.id), null);
});

test('图片读取端口按封闭线的实际消息绑定，其他联系人、群组和取消的线都拿不到', async () => {
  const p = await peers();
  const bytes = Buffer.from(PNG, 'base64');
  const id = await upload(p.a.app, p.a.cookie, bytes, 'private-pixel.png');
  await deliver(p, [id]);
  const state = p.b.app.state;
  const message = state.contactMessages.recent(p.ba.id, 10).find((row) => row.kind === 'text')!;
  await p.b.app.app.deps.network.attachments.prepare(message.id);
  const line = state.lines.create({ kind: 'background', title: '图片答话', projectId: null,
    parentLineId: null, sealedPrompt: '当前聊天。' });
  state.lines.update(line.id, { status: 'queued' });
  state.netResponses.create({ lineId: line.id, origin: 'contact', mode: 'answer', contactId: p.ba.id,
    groupId: null, questionId: message.id, exchangeId: 'exchange-fixture', askerIsAi: false,
    materials: [], status: 'running' });
  const images = p.b.app.app.deps.network.attachments.contextImages(line.id);
  assert.equal(images.length, 1);
  assert.equal(images[0]!.data, bytes.toString('base64'));
  for (const title of ['另一位联系人', '另一个群组']) {
    const other = state.lines.create({ kind: 'background', title, projectId: null,
      parentLineId: null, sealedPrompt: '另一段聊天。' });
    state.lines.update(other.id, { status: 'queued' });
    assert.deepEqual(p.b.app.app.deps.network.attachments.contextImages(other.id), []);
  }
  state.lines.update(line.id, { status: 'failed', failure: '已取消读取' });
  assert.deepEqual(p.b.app.app.deps.network.attachments.contextImages(line.id), []);
  assert.equal(JSON.stringify(state.lineMessages.after(line.id, 0)).includes(bytes.toString('base64')), false);
});

test('发件箱失败后重试原消息，不重建附件或重复收件；非法发送方handle不能用于拉取地址', async () => {
  const p = await peers();
  const id = await upload(p.a.app, p.a.cookie);
  const sent = await deliver(p, [id]);
  const messageId = String(sent['id']);
  const message = p.a.app.state.contactMessages.require(messageId);
  p.a.app.state.contactMessages.update(message.id, message.version, { status: 'failed', error: '测试连接中断' });
  const retried = await call(p.a.app, 'POST', `/v2/contacts/${p.ab.id}/messages/${messageId}/retry`,
    { cookie: p.a.cookie, body: { requestId: 'retry-fixture-message' } });
  assert.equal(retried.status, 200);
  assert.equal((json(retried)['message'] as { id: string }).id, messageId);
  await p.a.app.app.deps.network.flushOutbox();
  await p.b.app.app.deps.network.syncOnce();
  const received = p.b.app.state.contactMessages.recent(p.ba.id, 10).filter((row) => row.kind === 'text');
  assert.equal(received.length, 1);
  const attachment = p.b.app.state.networkAttachments.forMessage(received[0]!.id)[0]!;
  const sender = p.b.app.state.contacts.require(p.ba.id);
  p.b.app.state.contacts.update(sender.id, sender.version, { handle: 'invalid@127.0.0.1' });
  const path = `/v2/contacts/${p.ba.id}/messages/${received[0]!.id}/attachments/${attachment.id}/content`;
  assert.equal((await call(p.b.app, 'GET', path, { cookie: p.b.cookie })).status, 409);
  assert.equal(p.b.app.state.networkAttachments.bytes(attachment.id), null);
});
