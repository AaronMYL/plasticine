import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { Value } from 'typebox/value';
import { PushPayloadSchema } from '../../shared/api/index.ts';
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

test('推送异常的 message、cause 和伪造 name 不进日志或订阅失败记录', async (context) => {
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

test('立刻打断的卡发一条系统通知：只有类型、一句固定的话和链接，不带问题、依据和任务名', async () => {
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

test('主线通知的系统通知（announce）：同样加密发给每个还配对着的订阅，载荷原样是那一句和站内链接', async () => {
  const browser = fakeBrowser();
  push.subscribe(device('手机'), 'https://push.example.com/send/abc', browser.keys);
  await push.announce({ title: 'Plasticine', body: '有项目过了截止', url: '/#/projects/p1', tag: 'project-overdue:p1' });
  assert.equal(sent.length, 1);
  const payload: unknown = JSON.parse(browser.decrypt(sent[0]!.request.body));
  assert.deepEqual(payload, { title: 'Plasticine', body: '有项目过了截止', url: '/#/projects/p1',
    tag: 'project-overdue:p1' });
});

test('弹框和下次汇报档的卡不推送', async () => {
  push.subscribe(device('手机'), 'https://push.example.com/send/abc', fakeBrowser().keys);
  raise({ channel: 'popup' });
  raise({ channel: 'next_report' });
  await h.presenter.settled();
  assert.equal(sent.length, 0);
});

test('Web Push 加密前清洗整个载荷，解密后的文本无链接凭据并保留文章参数', async () => {
  const browser = fakeBrowser();
  push.subscribe(device('手机'), 'https://push.example.com/send/abc', browser.keys);
  const ask = raise({ channel: 'popup' });
  await h.presenter.settled();
  // 历史载荷中的字符串也经过边界兜底；用合成标识把文本送进 tag，问题正文仍不外发。
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

test('撤销了的设备不再收到；推送服务说订阅没了（410）就停用那个订阅', async () => {
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

test('退订：停用、行还在；再退一次说没有；同一个 endpoint 再订阅就重新启用', () => {
  const phone = device('手机');
  const endpoint = 'https://push.example.com/send/abc';
  push.subscribe(phone, endpoint, fakeBrowser().keys);
  assert.equal(push.unsubscribe(endpoint), true);
  assert.equal(push.unsubscribe(endpoint), false);
  assert.notEqual(h.state.pushSubscriptions.byEndpoint(endpoint), undefined);
  const again = push.subscribe(phone, endpoint, fakeBrowser().keys);
  assert.equal(again.revokedAt, null);
});

test('发送还没返回时同一 endpoint 重新订阅：旧请求随后回 410，不停用刚重新启用的订阅', async () => {
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

test('两条通知同时发给同一个订阅：先回来的成功不挡住后回来的 410，订阅照样停用', async () => {
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

test('浏览器给的钥匙不对：拒绝订阅；长度和 0x04 前缀都对、但不是曲线上的点也拒绝', () => {
  const notOnCurve = Buffer.concat([Buffer.from([0x04]), Buffer.alloc(64, 1)]).toString('base64url');
  for (const p256dh of [Buffer.alloc(65, 1).toString('base64url'), notOnCurve]) {
    assert.throws(
      () => push.subscribe(device('手机'), 'https://push.example.com/send/abc', { p256dh, auth: 'A'.repeat(16) }),
      (error: unknown) => error instanceof AttentionError && error.code === 'invalid_subscription',
    );
  }
  assert.equal(h.state.pushSubscriptions.active().length, 0);
});

test('发送出错时日志和库里只有受控错误类型，没有地址里的令牌和错误原文', async (t) => {
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

test('订阅地址带用户名密码或不是 https：拒绝订阅', () => {
  for (const endpoint of ['https://user:pass@push.example.com/send/abc', 'http://push.example.com/send/abc']) {
    assert.throws(
      () => push.subscribe(device('手机'), endpoint, fakeBrowser().keys),
      (error: unknown) => error instanceof AttentionError && error.code === 'invalid_subscription',
    );
  }
  assert.equal(h.state.pushSubscriptions.active().length, 0);
});

test('推送服务不通：记下失败、写日志，卡照样在清单里', async () => {
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
