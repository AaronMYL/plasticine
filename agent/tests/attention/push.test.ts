import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { Value } from 'typebox/value';
import { NOTIFY_KINDS_DEFAULT, PushPayloadSchema, type NotifyKinds } from '../../shared/api/index.ts';
import {
  AttentionError,
  generateVapidKeys,
  PUSH_BODY,
  PushService,
  type PushRequest,
  type RaiseAsk,
} from '../../src/attention/index.ts';
import { harness, type Harness } from './desk-harness.ts';
import { fakeBrowser } from './helpers.ts';
import { assertNoPrivateText, captureLogs, PRIVATE_ERROR_TEXT, privateError } from '../safety-helpers.ts';
import { ARTICLE_URLS, CLEAN_LINK_TEXT, CREDENTIAL_LINK_TEXT } from '../url-fixtures.ts';

let h: Harness;
let sent: { endpoint: string; request: PushRequest }[];
let status: number;
let push: PushService;

beforeEach(() => {
  h = harness();
  sent = [];
  status = 201;
  push = new PushService({
    state: h.state,
    keys: generateVapidKeys(),
    subject: 'https://plasticine.test',
    now: h.clock.now,
    transport: async (endpoint, request) => {
      sent.push({ endpoint, request });
      return { status };
    },
  });
  h.presenter.setNotifier(push);
});

afterEach(() => {
  h.close();
});

const SECRET_QUESTION = '要不要把工资卡 6222 0000 1234 的流水发给会计？';

test('push exception message, cause, and spoofed name never enter logs or failure records', async (context) => {
  const logs = captureLogs(context);
  const error = privateError();
  error.name = PRIVATE_ERROR_TEXT;
  const failing = new PushService({
    state: h.state, keys: generateVapidKeys(), subject: 'https://plasticine.test',
    transport: async () => { throw error; },
  });
  const browser = fakeBrowser();
  failing.subscribe(device('测试设备'), 'https://push.example/test?token=abc', browser.keys);
  const ask = raise();
  await failing.notify(ask);
  assert.ok(logs.length > 0);
  assertNoPrivateText(logs);
  assertNoPrivateText(h.state.pushSubscriptions.active().map((item) => item.lastError));
});

function device(name: string): string {
  const at = h.clock.now().toISOString();
  return h.state.devices.create({ name, firstSeenAt: at, lastSeenAt: at }).id;
}

function raise(overrides: Partial<RaiseAsk> = {}) {
  return h.desk.commit((changes) =>
    h.desk.raise(changes, {
      kind: 'act',
      purpose: 'line_question',
      question: SECRET_QUESTION,
      detail: '账单里有你的工资明细',
      options: [{ id: 'done', label: '我做好了', recommended: true }],
      channel: 'interrupt',
      ...overrides,
    }),
  );
}

test('immediate-interrupt card sends fixed one-line push with link, omitting question/basis/task', async () => {
  const browser = fakeBrowser();
  push.subscribe(device('手机'), 'https://push.example.com/send/abc', browser.keys);
  const ask = raise();
  await h.presenter.settled();
  assert.equal(sent.length, 1);
  const [{ endpoint, request } = { endpoint: '', request: { headers: {}, body: Buffer.alloc(0) } }] = sent;
  assert.equal(endpoint, 'https://push.example.com/send/abc');
  assert.equal(request.headers['content-encoding'], 'aes128gcm');
  assert.match(request.headers['authorization'] ?? '', /^vapid t=.+, k=/);
  assert.equal(request.body.includes(Buffer.from('6222')), false, '发出去的是密文');
  const text = browser.decrypt(request.body);
  const payload: unknown = JSON.parse(text);
  assert.ok(Value.Check(PushPayloadSchema, payload));
  assert.deepEqual(payload, { title: '等你动手', body: PUSH_BODY, url: `/?ask=${ask.id}`, tag: `ask-${ask.id}` });
  for (const secret of ['6222', '工资', '会计', '十月账单', '私密']) {
    assert.equal(text.includes(secret), false, `推送里不该有「${secret}」`);
  }
});

test('announce push encrypts one-line text and link to every paired subscription', async () => {
  const browser = fakeBrowser();
  push.subscribe(device('手机'), 'https://push.example.com/send/abc', browser.keys);
  await push.announce({ title: 'Plasticine', body: '有项目过了截止', url: '/#/projects/p1', tag: 'project-overdue:p1' });
  assert.equal(sent.length, 1);
  const payload: unknown = JSON.parse(browser.decrypt(sent[0]!.request.body));
  assert.deepEqual(payload, { title: 'Plasticine', body: '有项目过了截止', url: '/#/projects/p1',
    tag: 'project-overdue:p1' });
});

test('modal and next-report cards do not trigger web push', async () => {
  push.subscribe(device('手机'), 'https://push.example.com/send/abc', fakeBrowser().keys);
  raise({ channel: 'popup' });
  raise({ channel: 'next_report' });
  await h.presenter.settled();
  assert.equal(sent.length, 0);
});

test('Web Push sanitizes full payload before encryption, stripping URL creds while keeping params', async () => {
  const browser = fakeBrowser();
  push.subscribe(device('手机'), 'https://push.example.com/send/abc', browser.keys);
  const ask = raise({ channel: 'popup' });
  await h.presenter.settled();
  const id = `${CREDENTIAL_LINK_TEXT} (${ARTICLE_URLS[1]})`;
  await push.notify({ ...ask, id });
  assert.equal(sent.length, 1);
  const request = sent[0]?.request;
  assert.ok(request);
  const text = browser.decrypt(request.body);
  const payload = JSON.parse(text) as Record<string, unknown>;
  assert.doesNotMatch(text, /u:p|token=abc/);
  assert.equal(payload['tag'], `ask-${CLEAN_LINK_TEXT} (${ARTICLE_URLS[1]})`);
  assert.equal(payload['body'], PUSH_BODY);
  assert.equal(h.state.asks.require(ask.id).id, ask.id);
});

test('revoked device receives no pushes; 410 from push service deactivates that subscription', async () => {
  const phone = device('手机');
  const laptop = device('电脑');
  push.subscribe(phone, 'https://push.example.com/send/phone', fakeBrowser().keys);
  push.subscribe(laptop, 'https://push.example.com/send/laptop', fakeBrowser().keys);
  h.state.devices.revoke(laptop, h.clock.now().toISOString());
  status = 410;
  raise();
  await h.presenter.settled();
  assert.deepEqual(sent.map((entry) => entry.endpoint), ['https://push.example.com/send/phone']);
  const gone = h.state.pushSubscriptions.byEndpoint('https://push.example.com/send/phone');
  assert.notEqual(gone?.revokedAt, null);
  assert.equal(h.state.pushSubscriptions.active().length, 1);
});

test('unsubscribe deactivates keeping row, reports missing on repeat, re-enables on re-subscribe', () => {
  const phone = device('手机');
  const endpoint = 'https://push.example.com/send/abc';
  push.subscribe(phone, endpoint, fakeBrowser().keys);
  assert.equal(push.unsubscribe(endpoint), true);
  assert.equal(push.unsubscribe(endpoint), false);
  assert.notEqual(h.state.pushSubscriptions.byEndpoint(endpoint), undefined);
  const again = push.subscribe(phone, endpoint, fakeBrowser().keys);
  assert.equal(again.revokedAt, null);
});

test('late 410 from in-flight push does not deactivate a re-enabled subscription on same endpoint', async () => {
  const pending: { respond?: (code: number) => void } = {};
  push = new PushService({
    state: h.state,
    keys: generateVapidKeys(),
    subject: 'https://plasticine.test',
    transport: () =>
      new Promise((resolve) => {
        pending.respond = (code) => resolve({ status: code });
      }),
  });
  h.presenter.setNotifier(push);
  const phone = device('手机');
  const endpoint = 'https://push.example.com/send/abc';
  push.subscribe(phone, endpoint, fakeBrowser().keys);
  raise();
  while (pending.respond === undefined) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  push.subscribe(phone, endpoint, fakeBrowser().keys);
  pending.respond(410);
  await h.presenter.settled();
  const now = h.state.pushSubscriptions.byEndpoint(endpoint);
  assert.equal(now?.revokedAt, null);
  assert.equal(now?.lastError, null);
  assert.equal(h.state.pushSubscriptions.active().length, 1);
});

test('concurrent pushes to same subscription: earlier success does not mask later 410 deactivation', async () => {
  const responders: ((code: number) => void)[] = [];
  push = new PushService({
    state: h.state,
    keys: generateVapidKeys(),
    subject: 'https://plasticine.test',
    transport: () =>
      new Promise((resolve) => {
        responders.push((code) => resolve({ status: code }));
      }),
  });
  h.presenter.setNotifier(push);
  const endpoint = 'https://push.example.com/send/abc';
  push.subscribe(device('手机'), endpoint, fakeBrowser().keys);
  raise();
  raise();
  while (responders.length < 2) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  responders[0]?.(201);
  await new Promise((resolve) => setImmediate(resolve));
  responders[1]?.(410);
  await h.presenter.settled();
  assert.notEqual(h.state.pushSubscriptions.byEndpoint(endpoint)?.revokedAt, null);
  assert.equal(h.state.pushSubscriptions.active().length, 0);
});

test('rejects invalid browser push key including off-curve point with valid length and 0x04 prefix', () => {
  const notOnCurve = Buffer.concat([Buffer.from([0x04]), Buffer.alloc(64, 1)]).toString('base64url');
  for (const p256dh of [Buffer.alloc(65, 1).toString('base64url'), notOnCurve]) {
    assert.throws(
      () => push.subscribe(device('手机'), 'https://push.example.com/send/abc', { p256dh, auth: 'A'.repeat(16) }),
      (error: unknown) => error instanceof AttentionError && error.code === 'invalid_subscription',
    );
  }
  assert.equal(h.state.pushSubscriptions.active().length, 0);
});

test('push send failure logs only controlled error type, omitting endpoint token and raw error', async (t) => {
  const logged: string[] = [];
  const text = (arg: unknown): string => (arg instanceof Error ? `${arg.message} ${arg.stack ?? ''}` : String(arg));
  t.mock.method(console, 'error', (...args: unknown[]) => {
    logged.push(args.map(text).join(' '));
  });
  const endpoint = 'https://push.example.com/send/secret-capability-token';
  push = new PushService({
    state: h.state,
    keys: generateVapidKeys(),
    subject: 'https://plasticine.test',
    transport: async () => {
      throw Object.assign(new TypeError(`fetch failed: ${endpoint} 拒绝连接`), { code: 'ECONNREFUSED' });
    },
  });
  h.presenter.setNotifier(push);
  push.subscribe(device('手机'), endpoint, fakeBrowser().keys);
  raise();
  await h.presenter.settled();
  const lastError = h.state.pushSubscriptions.byEndpoint(endpoint)?.lastError ?? '';
  assert.equal(lastError, '发送失败（TypeError）');
  assert.ok(logged.some((line) => line.includes('push_failed') && line.includes('TypeError')));
  for (const text of [...logged, lastError]) {
    assert.equal(text.includes('secret-capability-token'), false, text);
    assert.equal(text.includes('拒绝连接'), false, text);
  }
});

test('rejects push subscription with URL credentials or non-https scheme', () => {
  for (const endpoint of ['https://user:pass@push.example.com/send/abc', 'http://push.example.com/send/abc']) {
    assert.throws(
      () => push.subscribe(device('手机'), endpoint, fakeBrowser().keys),
      (error: unknown) => error instanceof AttentionError && error.code === 'invalid_subscription',
    );
  }
  assert.equal(h.state.pushSubscriptions.active().length, 0);
});

test('unreachable push service logs failure while keeping card in waiting list', async () => {
  push = new PushService({
    state: h.state,
    keys: generateVapidKeys(),
    subject: 'https://plasticine.test',
    transport: async () => {
      throw new Error('连不上');
    },
  });
  h.presenter.setNotifier(push);
  push.subscribe(device('手机'), 'https://push.example.com/send/abc', fakeBrowser().keys);
  const ask = raise();
  await h.presenter.settled();
  assert.equal(h.state.asks.get(ask.id)?.status, 'open');
  assert.match(h.state.pushSubscriptions.byEndpoint('https://push.example.com/send/abc')?.lastError ?? '', /发送失败/);
});

test('transient push network error retries once and succeeds without logging failure; rejects skip', async () => {
  let calls = 0;
  let answer = 201;
  push = new PushService({
    state: h.state,
    keys: generateVapidKeys(),
    subject: 'https://plasticine.test',
    now: h.clock.now,
    transport: async () => {
      calls += 1;
      if (calls === 1) {
        throw new TypeError('fetch failed');
      }
      return { status: answer };
    },
  });
  const phone = device('手机');
  push.subscribe(phone, 'https://push.example.com/send/retry', fakeBrowser().keys);
  assert.deepEqual(await push.test(phone), { sent: 1, error: null });
  assert.equal(calls, 2);
  assert.equal(h.state.pushSubscriptions.byEndpoint('https://push.example.com/send/retry')?.lastError, null);
  answer = 500;
  assert.equal((await push.test(phone)).sent, 0);
  assert.equal(calls, 3);
});

test('test push sends only to current device subscriptions, reports sent/errors or disabled state', async () => {
  const mac = device('Mac');
  const phone = device('iPhone');
  assert.deepEqual(await push.test(mac), { sent: 0, error: '这台设备还没打开系统通知' });
  push.subscribe(mac, 'https://push.example/mac', fakeBrowser().keys);
  push.subscribe(phone, 'https://push.example/phone', fakeBrowser().keys);
  assert.deepEqual(await push.test(mac), { sent: 1, error: null });
  assert.deepEqual(sent.map((item) => item.endpoint), ['https://push.example/mac']);
  status = 500;
  assert.deepEqual(await push.test(mac), { sent: 0, error: '推送服务拒收（HTTP 500）' });
});

test('disabled push category suppresses matching notifications while untyped notices still send', async () => {
  const kinds: NotifyKinds = { ...NOTIFY_KINDS_DEFAULT, ask: false, letter: false };
  const gated = new PushService({ state: h.state, keys: generateVapidKeys(), subject: 'https://plasticine.test',
    now: h.clock.now, kinds: () => kinds,
    transport: async (endpoint, request) => {
      sent.push({ endpoint, request });
      return { status };
    } });
  h.presenter.setNotifier(gated);
  gated.subscribe(device('手机'), 'https://push.example/kinds', fakeBrowser().keys);
  await gated.notify(raise());
  await gated.announce({ title: 'Plasticine', body: '给你写了一封信', url: '/', tag: 'letter:1' }, 'letter');
  assert.equal(sent.length, 0);
  await gated.announce({ title: 'Plasticine', body: '服务器磁盘空间不足', url: '/', tag: 'disk' }, 'notice');
  await gated.announce({ title: 'Plasticine', body: '测试', url: '/', tag: 'x' });
  assert.equal(sent.length, 2);
  kinds.ask = true;
  await gated.notify(raise({ question: '再问一件' }));
  assert.ok(sent.length >= 3, '打开以后照推');
});
