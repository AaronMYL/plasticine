import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { LineMessageView, MessageWidget } from '../../../src/api/shared.ts';
import { MAIN_LINE_ID } from '../../../src/api/fake/fake-lines.ts';
import { renderApp } from '../../helpers.tsx';
import { sortedRows, totalRow } from '../../../src/primitives/message/widgets/table-math.ts';

function message(role: LineMessageView['role'], text: string): Omit<LineMessageView, 'lineId' | 'seq'> {
  return { role, text, origin: null, thinking: null, thinkingMs: null, steps: [], toolCallId: null, tool: null,
    say: null, ok: null, summary: null, stopReason: null, childLineId: null, attachments: [], widgets: [],
    createdAt: '2026-11-16T00:00:00.000Z' };
}

const TABLE: MessageWidget = { kind: 'table', id: 'w-table', caption: '各渠道投递', total: true,
  columns: [{ key: 'channel', label: '渠道' }, { key: 'count', label: '份数', align: 'end' },
    { key: 'rate', label: '回复率', align: 'end' }],
  rows: [{ channel: '示例招聘', count: '12', rate: '25%' }, { channel: '官网', count: '3', rate: '33%' },
    { channel: '内推', count: '1,005', rate: '10%' }] };

const CHART: MessageWidget = { kind: 'chart', id: 'w-chart', title: '每周投递', type: 'bar', unit: '份',
  series: [{ name: '投递', points: [{ x: '第 1 周', y: 4 }, { x: '第 2 周', y: 7 }, { x: '第 3 周', y: 9 }] }] };

async function open(widgets: MessageWidget[]) {
  await renderApp({ hash: '#/messages/plasticine', setup({ control }) {
    control.lines.record(MAIN_LINE_ID, { ...message('assistant', '看这个。'), stopReason: 'toolUse',
      steps: [{ toolCallId: 'w', tool: 'show_widgets', say: '放表格' }] });
    control.lines.record(MAIN_LINE_ID, { ...message('toolResult', '放好了'), toolCallId: 'w', tool: 'show_widgets',
      ok: true, widgets });
    control.lines.record(MAIN_LINE_ID, message('assistant', '就这些。'));
  } });
}

describe('Tables in conversation', () => {
  it('totals sum only right-aligned numeric columns (not percents), keep commas, and sort numerically', () => {
    if (TABLE.kind !== 'table') throw new Error('table');
    expect(totalRow(TABLE)).toEqual({ channel: '合计', count: '1,020' });
    expect(sortedRows(TABLE.rows, { key: 'count', direction: 'desc' }).map((row) => row['channel']))
      .toEqual(['内推', '示例招聘', '官网']);
    expect(totalRow({ ...TABLE, total: false })).toBeNull();
  });

  it('clicking header cycles ascending, descending, and unsorted while keeping total row at bottom', async () => {
    await open([TABLE]);
    const table = await screen.findByRole('table');
    const order = (): string[] => within(table).getAllByRole('row').slice(1)
      .map((row) => within(row).getAllByRole('cell')[0]?.textContent ?? '');
    expect(order()).toEqual(['示例招聘', '官网', '内推', '合计']);
    fireEvent.click(within(table).getByRole('button', { name: '份数' }));
    expect(order()).toEqual(['官网', '示例招聘', '内推', '合计']);
    expect(within(table).getByRole('columnheader', { name: /份数/ }).getAttribute('aria-sort')).toBe('ascending');
    fireEvent.click(within(table).getByRole('button', { name: /份数/ }));
    expect(order()).toEqual(['内推', '示例招聘', '官网', '合计']);
    fireEvent.click(within(table).getByRole('button', { name: /份数/ }));
    expect(order()).toEqual(['示例招聘', '官网', '内推', '合计']);
  });

  it('Download table saves into Tables folder on Files page', async () => {
    await open([TABLE]);
    fireEvent.click(await screen.findByRole('button', { name: '下载表格' }));
    expect(await screen.findByText(/已存进文件页「表格」：各渠道投递 \d{4}-\d{2}-\d{2}\.xlsx/)).toBeTruthy();
  });
});

describe('Charts in conversation', () => {
  it('renders bars with title as accessible name and shows value and unit tooltip on hover', async () => {
    await open([CHART]);
    const chart = await screen.findByRole('img', { name: '每周投递，投递' });
    const bars = chart.querySelectorAll('rect');
    expect(bars).toHaveLength(3);
    expect(bars[2]?.getAttribute('fill')).toBe('var(--hue-clay)');
    expect(bars[0]?.getAttribute('fill')).toBe('var(--hue-sky)');
    fireEvent.pointerEnter(bars[1]!);
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('第 2 周7份'));
  });
});
