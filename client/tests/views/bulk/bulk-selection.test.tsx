import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ApiError } from '../../../src/api/errors.ts';
import { useBulkSelection, type BulkItem } from '../../../src/views/bulk/use-bulk-selection.ts';

const items: BulkItem[] = ['甲', '乙', '丙', '丁'].map((title, index) => ({ kind: 'note', id: String(index), title }));
const success = (input: { items: readonly BulkItem[] }) => ({
  results: input.items.map((item) => ({ ...item, title: item.id, ok: true, error: null })),
  succeeded: input.items.length, failed: 0,
});

it('全选只选当前列表，Shift 连选，列表刷新后不会留下隐藏选择', () => {
  const { result, rerender } = renderHook(({ rows }) => useBulkSelection({ items: rows,
    run: vi.fn(), onChanged: vi.fn() }), { initialProps: { rows: items } });
  act(() => result.current.start());
  act(() => result.current.toggle(items[0]!));
  act(() => result.current.toggle(items[2]!, true));
  expect(result.current.selected.map((item) => item.id)).toEqual(['0', '1', '2']);
  act(() => result.current.all());
  expect(result.current.selected).toHaveLength(4);
  rerender({ rows: items.slice(0, 2) });
  expect(result.current.selected).toHaveLength(2);
  act(() => result.current.finish());
  expect(result.current.active).toBe(false);
  expect(result.current.selected).toEqual([]);
});

it('部分成功后只保留失败项，重试只发送失败项并使用新请求标识', async () => {
  const run = vi.fn().mockResolvedValueOnce({ succeeded: 1, failed: 1, results: [
    { ...items[0], ok: true, error: null }, { ...items[1], ok: false, error: '目标已有同名笔记' },
  ] }).mockImplementation(async (input) => success(input));
  const changed = vi.fn();
  const { result } = renderHook(() => useBulkSelection({ items: items.slice(0, 2), run, onChanged: changed }));
  act(() => { result.current.start(); result.current.all(); });
  await act(async () => result.current.perform('move', '归档'));
  expect(result.current.selected.map((item) => item.id)).toEqual(['1']);
  expect(result.current.report?.results[1]?.error).toBe('目标已有同名笔记');
  await act(async () => result.current.retry());
  expect(run.mock.calls[1]?.[0]).toMatchObject({ action: 'move', destination: '归档',
    items: [{ kind: 'note', id: '1' }] });
  expect(run.mock.calls[1]?.[0].requestId).not.toBe(run.mock.calls[0]?.[0].requestId);
  expect(changed).toHaveBeenCalledTimes(2);
});

it('结果不确定时保留原请求核实，清空遇到数量冲突会刷新并要求重新确认', async () => {
  const run = vi.fn().mockRejectedValueOnce(new ApiError({ kind: 'uncertain', code: 'network', message: '回执未到' }))
    .mockImplementation(async (input) => success(input));
  const empty = vi.fn().mockRejectedValue(new ApiError({ kind: 'conflict', code: 'version_conflict',
    status: 409, message: '最近删除的数量变了，请刷新后重新确认。' }));
  const changed = vi.fn();
  const { result } = renderHook(() => useBulkSelection({ items, run, empty, onChanged: changed }));
  act(() => { result.current.start(); result.current.all(); });
  await act(async () => result.current.perform('trash'));
  expect(result.current.uncertain).toBe(true);
  await act(async () => result.current.retry());
  expect(run.mock.calls[1]?.[0]).toEqual(run.mock.calls[0]?.[0]);
  await act(async () => result.current.empty());
  expect(empty.mock.calls[0]?.[0]).toMatchObject({ expectCount: 4 });
  expect(result.current.error).toContain('重新确认');
  expect(result.current.canRetry).toBe(false);
  expect(changed).toHaveBeenCalledTimes(2);
});
