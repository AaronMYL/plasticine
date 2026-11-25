import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Value } from 'typebox/value';
import { MessageWidgetSchema, WidgetDraftSchema } from '../../shared/api/index.ts';
import { buildWidget } from '../../src/tools/show-widgets.ts';

const facts = { moneyCategories: () => [], monthCategoryCents: () => 0 };
const now = new Date('2026-11-16T08:00:00.000Z');

test('Chart draft supports bar/line/scatter with optional title/unit matching schema', () => {
  const draft = { kind: 'chart', type: 'bar', title: '每周投递', unit: '份',
    series: [{ name: '投递', points: [{ x: '第 1 周', y: 4 }, { x: '第 2 周', y: 7 }] }] };
  assert.ok(Value.Check(WidgetDraftSchema, draft));
  const widget = buildWidget(draft as never, facts as never, now);
  assert.equal(widget.kind, 'chart');
  assert.ok(Value.Check(MessageWidgetSchema, widget));
  assert.ok(!Value.Check(WidgetDraftSchema, { ...draft, type: 'pie' }));
  assert.ok(!Value.Check(WidgetDraftSchema, { ...draft, series: [] }));
});

test('Table draft writes total into widget only when provided', () => {
  const draft = { kind: 'table', columns: [{ key: 'a', label: '份数', align: 'end' }], rows: [{ a: '1' }] };
  const plain = buildWidget(draft as never, facts as never, now);
  assert.equal('total' in plain, false);
  const summed = buildWidget({ ...draft, total: true } as never, facts as never, now);
  assert.equal(summed.kind === 'table' && summed.total, true);
});
