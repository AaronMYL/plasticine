import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { type TextStep } from '../brain/helpers.ts';
import { call, json, pair, startTestApp, uploadAttachment, type TestApp } from './helpers.ts';

// 《置信度与做事方式改动方案》第二批「记账直接记」：
//   识别清楚 + 商户以前归过类 → 直接入账，不打扰；新商户或类别拿不准 → 按最像的类别入账、标「待看」，不弹卡；
//   金额看不清，或者同一张截图、同一笔账已经记过 → 才出卡问。原图先留着，每周汇总里一键清掉。

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ9sAAAAASUVORK5CYII=';

const CLEAR = {
  amountCents: 1234,
  currency: 'CNY',
  merchant: '书店',
  occurredAt: '2026-10-27T07:00:00.000Z',
  kind: 'expense',
  accountId: null,
  categoryId: 'study',
  basis: '使用实付金额，未使用订单总额',
  uncertainty: '',
};

function reading(candidate: Record<string, unknown>): TextStep {
  return (JSON.stringify(candidate));
}

async function upload(app: TestApp, cookie: string, name: string, salt: string): Promise<string> {
  const data = Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.from(salt)]);
  const image = await uploadAttachment(app, cookie, { requestId: `image-${name}`, name: `${name}.png`,
    mimeType: 'image/png', content: data });
  return String(image['id']);
}

async function screenshot(app: TestApp, cookie: string, name: string, salt = name): Promise<Record<string, unknown>> {
  const attachmentId = await upload(app, cookie, name, salt);
  const created = await call(app, 'POST', '/v2/money/drafts', { cookie,
    body: { requestId: `draft-${name}`, attachmentId, messageId: null } });
  assert.equal(created.status, 202);
  await app.app.deps.paymentReader.settled();
  return json(await call(app, 'GET', `/v2/money/drafts/${String(json(created)['id'])}`, { cookie }));
}

function moneyCards(app: TestApp): number {
  return app.state.asks.open().filter((ask) => ask.purpose === 'money_confirmation').length;
}

test('识别清楚、商户以前归过类：直接入账不出卡，按你上次归的类；原图留着', async () => {
  const app = await startTestApp([reading({ ...CLEAR, categoryId: 'shop' }), reading({ ...CLEAR,
    occurredAt: '2026-10-28T07:00:00.000Z', categoryId: 'shop' })]);
  try {
    const cookie = await pair(app);
    app.app.deps.m5b.life.money.categories();
    app.state.moneyEntries.create({ kind: 'expense', amountCents: 5000, currency: 'CNY', cnyCents: 5000,
      categoryId: 'study', accountId: null, toAccountId: null, merchant: '书店', note: null,
      occurredAt: '2026-10-20T07:00:00.000Z', discountCents: null, feeCents: null, confidence: null, review: false,
      origin: 'manual' });
    const draft = await screenshot(app, cookie, 'first');
    assert.equal(draft['status'], 'confirmed');
    assert.equal(draft['askId'], null);
    assert.equal(moneyCards(app), 0);
    const entry = app.state.moneyEntries.require(String(draft['entryId']));
    assert.equal(entry.categoryId, 'study');
    assert.equal(entry.review, false);
    assert.equal(entry.origin, 'ai');
    const original = await call(app, 'GET', `/v2/conversation/attachments/${String(draft['attachmentId'])}/content`,
      { cookie });
    assert.equal(original.status, 200);
  } finally {
    await app.close();
  }
});

test('新商户：按最像的类别入账、标成待看，不弹卡；你改过一次类别，同一商户以后按你改的记', async () => {
  const app = await startTestApp([reading({ ...CLEAR, merchant: '面馆', categoryId: 'shop' }),
    reading({ ...CLEAR, merchant: '面馆', categoryId: 'shop', occurredAt: '2026-10-29T04:00:00.000Z' }),
    reading({ ...CLEAR, merchant: '新店', categoryId: 'no-such-category', occurredAt: '2026-10-30T04:00:00.000Z' })]);
  try {
    const cookie = await pair(app);
    const first = await screenshot(app, cookie, 'noodles-1');
    assert.equal(first['status'], 'confirmed');
    assert.equal(moneyCards(app), 0);
    const entry = app.state.moneyEntries.require(String(first['entryId']));
    assert.equal(entry.categoryId, 'shop');
    assert.equal(entry.review, true);
    const edited = await call(app, 'PUT', `/v2/money/entries/${entry.id}`, { cookie,
      body: { requestId: 'edit-category-1', version: entry.version, categoryId: 'food' } });
    assert.equal(edited.status, 200);
    const second = await screenshot(app, cookie, 'noodles-2');
    const next = app.state.moneyEntries.require(String(second['entryId']));
    assert.equal(next.categoryId, 'food');
    assert.equal(next.review, false);
    const unknown = await screenshot(app, cookie, 'new-shop');
    const guessed = app.state.moneyEntries.require(String(unknown['entryId']));
    assert.equal(guessed.categoryId, null);
    assert.equal(guessed.review, true);
    assert.equal(moneyCards(app), 0);
  } finally {
    await app.close();
  }
});

test('金额看不清才出卡：本人会话无钥匙核对后只记一笔，普通答卡不能旁路，原图不再自动删', async () => {
  const app = await startTestApp([reading({ ...CLEAR, amountCents: null, uncertainty: '金额被遮住' })]);
  try {
    const cookie = await pair(app);
    app.clock.advance(20 * 60_000);
    const draft = await screenshot(app, cookie, 'blurry');
    assert.equal(draft['status'], 'ready');
    assert.equal(app.state.moneyEntries.all().length, 0);
    assert.equal(moneyCards(app), 1);
    const askId = String(draft['askId']);
    assert.equal(app.state.asks.require(askId).basis, 'missing', '金额看不清：资料里没有');
    const bypass = await call(app, 'POST', `/v2/asks/${askId}/answer`, { cookie,
      body: { requestId: 'payment-bypass-001', optionId: 'confirm' } });
    assert.equal(bypass.status, 403);
    const id = String(draft['id']);
    const corrected = { ...CLEAR, amountCents: 1300 };
    const edit = await call(app, 'PUT', `/v2/money/drafts/${id}`, { cookie,
      body: { requestId: 'payment-edit-001', version: draft['version'], candidate: corrected } });
    assert.equal(edit.status, 200);
    const saved = json(edit);
    const confirm = { requestId: 'payment-confirm-001', version: saved['version'], askVersion: saved['askVersion'],
      fields: { amountCents: 1300, currency: 'CNY', merchant: '书店', occurredAt: CLEAR.occurredAt, kind: 'expense',
        accountId: null, categoryId: 'study' } };
    const path = `/v2/money/drafts/${id}/confirm`;
    const altered = { ...confirm, requestId: 'payment-altered', fields: { ...confirm.fields, amountCents: 1500 } };
    assert.equal((await call(app, 'POST', path, { cookie, body: altered })).status, 409);
    const first = await call(app, 'POST', path, { cookie, body: confirm });
    assert.equal(first.status, 200);
    const entryId = String(json(first)['entryId']);
    assert.equal(app.state.moneyEntries.require(entryId).amountCents, 1300);
    assert.equal(app.state.moneyEntries.require(entryId).review, false);
    assert.equal(existsSync(join(app.directory, 'attachments', `${String(draft['attachmentId'])}.bin`)), true);
    app.clock.advance(25 * 60 * 60 * 1000);
    const again = await call(app, 'POST', path, { cookie, body: confirm });
    assert.equal(json(again)['entryId'], entryId);
    assert.equal(app.state.moneyEntries.all().length, 1);
  } finally {
    await app.close();
  }
});

test('同一笔账已经记过（另一张截图、同金额同时间）才问一句；同一张截图再发不再识别也不再出卡', async () => {
  const app = await startTestApp([reading(CLEAR), reading(CLEAR)]);
  try {
    const cookie = await pair(app);
    const first = await screenshot(app, cookie, 'bill-a');
    assert.equal(first['status'], 'confirmed');
    const twin = await screenshot(app, cookie, 'bill-b');
    assert.equal(twin['status'], 'ready');
    assert.equal(twin['duplicateEntryId'], first['entryId']);
    assert.equal(moneyCards(app), 1);
    assert.equal(app.state.asks.require(String(twin['askId'])).basis, 'options', '好像记过：两种都说得通');
    assert.equal(app.state.moneyEntries.all().length, 1);
    const again = await call(app, 'POST', '/v2/money/drafts', { cookie,
      body: { requestId: 'draft-bill-a-again', attachmentId: first['attachmentId'], messageId: null } });
    assert.equal(json(again)['id'], first['id']);
    assert.equal(app.requests.length, 2);
    assert.deepEqual(app.requests.map((request) => request.purpose), ['payment_read', 'payment_read']);
  } finally {
    await app.close();
  }
});

test('每周汇总：这周直接记了几笔、几笔待看、留着几张原图；一键清掉已记账的原图，账不动', async () => {
  const app = await startTestApp([reading(CLEAR), reading({ ...CLEAR, merchant: '面馆',
    occurredAt: '2026-10-28T07:00:00.000Z', categoryId: 'food' })]);
  try {
    const cookie = await pair(app);
    const first = await screenshot(app, cookie, 'week-1');
    await screenshot(app, cookie, 'week-2');
    const summary = json(await call(app, 'GET', '/v2/money/drafts/summary', { cookie }));
    assert.equal(summary['recorded'], 2);
    assert.equal(summary['review'], 2);
    assert.equal(summary['originals'], 2);
    const purge = await call(app, 'POST', '/v2/money/drafts/originals/purge', { cookie,
      body: { requestId: 'purge-originals-1' } });
    assert.equal(purge.status, 200);
    assert.equal(json(purge)['purged'], 2);
    const replay = await call(app, 'POST', '/v2/money/drafts/originals/purge', { cookie,
      body: { requestId: 'purge-originals-1' } });
    assert.equal(json(replay)['purged'], 2);
    const original = await call(app, 'GET', `/v2/conversation/attachments/${String(first['attachmentId'])}/content`,
      { cookie });
    assert.equal(original.status, 410);
    assert.equal(app.state.moneyEntries.all().length, 2);
    const after = json(await call(app, 'GET', '/v2/money/drafts/summary', { cookie }));
    assert.equal(after['originals'], 0);
  } finally {
    await app.close();
  }
});
