import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { AgreementInput, AgreementPatch } from '../../shared/state.ts';
import { brainChange, device, forged, openTestState, throwsState, type TestState } from './helpers.ts';

let t: TestState;

beforeEach(async () => {
  t = await openTestState();
});

afterEach(async () => {
  await t.cleanup();
});

function agreementInput(overrides: Partial<AgreementInput> = {}): AgreementInput {
  return { kind: 'collaboration', text: '发邮件前先问我', scope: '所有对外邮件', ...overrides };
}

test('新建约定一律是待议，没有生效时间，也没有设备确认', () => {
  const created = t.state.agreements.create(agreementInput({ premises: ['用户在国内'] }), brainChange());
  assert.equal(created.state, 'under_review');
  assert.equal(created.effectiveAt, null);
  assert.equal(created.confirmedByDeviceId, null);
  assert.deepEqual(created.premises, ['用户在国内']);
});

test('普通写入不能让约定生效或撤销，也不能写生效时间', () => {
  const created = t.state.agreements.create(agreementInput(), brainChange());
  const activate = forged<AgreementPatch>({ state: 'active' });
  throwsState(() => t.state.agreements.update(created.id, 1, activate, brainChange()), 'confirmation_required');
  const revoke = forged<AgreementPatch>({ state: 'revoked' });
  throwsState(() => t.state.agreements.update(created.id, 1, revoke, brainChange()), 'confirmation_required');
  const effective = forged<AgreementPatch>({ effectiveAt: '2026-10-27T00:00:00.000Z' });
  throwsState(() => t.state.agreements.update(created.id, 1, effective, brainChange()), 'confirmation_required');
  const createActive = { ...agreementInput(), state: 'active' };
  throwsState(() => t.state.agreements.create(createActive, brainChange()), 'confirmation_required');
  assert.equal(t.state.agreements.require(created.id).state, 'under_review');
});

test('带设备确认可以让约定生效；之后脑可以把它置回待议并写提议的改动', () => {
  const created = t.state.agreements.create(agreementInput(), brainChange());
  const effectiveAt = '2026-10-27T09:00:00.000Z';
  const active = t.state.agreements.confirm(created.id, 1, { state: 'active', effectiveAt }, device(), '用户点了采纳');
  assert.equal(active.state, 'active');
  assert.equal(active.confirmedByDeviceAt, device().confirmedAt);
  const review = t.state.agreements.update(
    created.id,
    2,
    { state: 'under_review', proposedDiff: '只对陌生收件人先问' },
    brainChange('前提变了'),
  );
  assert.equal(review.state, 'under_review');
  assert.equal(review.proposedDiff, '只对陌生收件人先问');
  assert.equal(review.confirmedByDeviceId, 'iphone-1');
});

test('改已生效约定的内容、范围、逐次确认或前提：同一次写入就退回待议，要重新确认', () => {
  const patches: AgreementPatch[] = [
    { text: '发邮件前不用问我' },
    { scope: '只限工作邮件' },
    { perUseConfirmation: true },
    { premises: ['用户出国了'] },
  ];
  for (const patch of patches) {
    const created = t.state.agreements.create(agreementInput(), brainChange());
    t.state.agreements.confirm(created.id, 1, { state: 'active' }, device(), '用户点了采纳');
    const edited = t.state.agreements.update(created.id, 2, patch, brainChange('改写'));
    assert.equal(edited.state, 'under_review', JSON.stringify(patch));
  }
});

test('改已生效约定的提议字段不动它的状态', () => {
  const created = t.state.agreements.create(agreementInput(), brainChange());
  t.state.agreements.confirm(created.id, 1, { state: 'active' }, device(), '用户点了采纳');
  const edited = t.state.agreements.update(created.id, 2, { proposedDiff: '加一条例外' }, brainChange('提议'));
  assert.equal(edited.state, 'active');
});

test('按状态列出约定', () => {
  const created = t.state.agreements.create(agreementInput({ kind: 'term', text: '「搁置」= 活跃转留意' }), brainChange());
  t.state.agreements.confirm(created.id, 1, { state: 'active' }, device(), '确认词表');
  assert.deepEqual(
    t.state.agreements.list({ state: 'active' }).map((agreement) => agreement.id),
    [created.id],
  );
  assert.deepEqual(t.state.agreements.list({ state: 'under_review' }), []);
});

test('迁移专用入口：旧指南迁过来就生效，标 migratedDefault（待你确认），版本记录写 migration', () => {
  const effectiveAt = '2026-09-01T00:00:00.000Z';
  const legacy = { section: 'work-style', revision: 3 };
  const imported = t.state.agreements.importEffective(agreementInput(), effectiveAt, legacy, '旧指南第 3 版');
  assert.equal(imported.state, 'active');
  assert.equal(imported.effectiveAt, effectiveAt);
  assert.equal(imported.migratedDefault, true);
  assert.deepEqual(imported.legacyPayload, legacy);
  assert.equal(imported.confirmedByDeviceId, null);
  const [entry] = t.state.agreements.history(imported.id);
  assert.equal(entry?.actor, 'migration');
  assert.ok(entry?.fields.includes('state'));
});

test('迁移专用入口别人用不了：普通新建夹带确认字段（哪怕冒充 migration）也只建出待议的约定', () => {
  const active = { state: 'active' as const, effectiveAt: '2026-10-27T00:00:00.000Z' };
  // The public create takes no confirmed fields at all; a caller that forces a fourth argument in gets nothing.
  type Created = ReturnType<typeof t.state.agreements.create>;
  const create = t.state.agreements.create as unknown as (...args: unknown[]) => Created;
  const migration = { actor: 'migration' as const, reason: '冒充导入' };
  const sneaky = create(agreementInput(), migration, { migratedDefault: true }, active);
  assert.equal(sneaky.state, 'under_review');
  assert.equal(sneaky.effectiveAt, null);
  assert.deepEqual(t.state.agreements.list({ state: 'active' }), []);
});

test('约定按新建先后倒序翻页，翻到底读得到全部', () => {
  const first = t.state.agreements.create(agreementInput({ text: '第一条' }), brainChange());
  const second = t.state.agreements.create(agreementInput({ text: '第二条' }), brainChange());
  assert.deepEqual(t.state.agreements.newestFirst({}, {}).map((agreement) => agreement.id), [second.id, first.id]);
  assert.deepEqual(t.state.agreements.newestFirst({}, { limit: 1, offset: 1 }).map((item) => item.id), [first.id]);
});
