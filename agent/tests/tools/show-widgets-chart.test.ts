// show_widgets 的图表和表格合计（11-16）：草稿 → 消息里的部件；图表、表格不用作答。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Value } from 'typebox/value';
import { MessageWidgetSchema, WidgetDraftSchema } from '../../shared/api/index.ts';
import { buildWidget } from '../../src/tools/show-widgets.ts';

const facts = { moneyCategories: () => [], monthCategoryCents: () => 0 };
const now = new Date('2026-11-16T08:00:00.000Z');

test('图表草稿：柱状 / 折线 / 散点，标题和单位可选；出来的部件合 schema', () => {
  const draft = { kind: 'chart', type: 'bar', title: '每周投递', unit: '份',
    series: [{ name: '投递', points: [{ x: '第 1 周', y: 4 }, { x: '第 2 周', y: 7 }] }] };
  assert.ok(Value.Check(WidgetDraftSchema, draft));
  const widget = buildWidget(draft as never, facts as never, now);
  assert.equal(widget.kind, 'chart');
  assert.ok(Value.Check(MessageWidgetSchema, widget));
  assert.ok(!Value.Check(WidgetDraftSchema, { ...draft, type: 'pie' }));
  assert.ok(!Value.Check(WidgetDraftSchema, { ...draft, series: [] }));
});

test('表格草稿带 total 才写进部件', () => {
  const draft = { kind: 'table', columns: [{ key: 'a', label: '份数', align: 'end' }], rows: [{ a: '1' }] };
  const plain = buildWidget(draft as never, facts as never, now);
  assert.equal('total' in plain, false);
  const summed = buildWidget({ ...draft, total: true } as never, facts as never, now);
  assert.equal(summed.kind === 'table' && summed.total, true);
});
