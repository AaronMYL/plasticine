import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { BulkHeader, BulkBar, BulkFeedback, purgeSummary } from '../../../src/views/bulk/bulk-controls.tsx';
import { useBulkSelection, type BulkItem } from '../../../src/views/bulk/use-bulk-selection.ts';

const items: BulkItem[] = [{ kind: 'space', id: 's', title: '例会记录' },
  { kind: 'folder', id: 'f', title: '示例文档', fileCount: 3 }, { kind: 'file', id: 'x', title: '说明.txt' }];

it('永久删除确认包含类型、文件夹内文件数，清空携带打开确认时的数量', async () => {
  const empty = vi.fn().mockResolvedValue({ results: [], succeeded: 3, failed: 0 });
  function Harness({ rows }: { rows: BulkItem[] }) {
    const selection = useBulkSelection({ items: rows, run: vi.fn(), empty, onChanged: vi.fn() });
    return <><BulkHeader selection={selection} items={rows} trash />
      <BulkBar selection={selection} trash /><BulkFeedback selection={selection} /></>;
  }
  const view = render(<Harness rows={items} />);
  fireEvent.click(screen.getByRole('button', { name: '清空' }));
  expect(screen.getByRole('alertdialog', { name: '永久删除这 3 项？' })).toBeTruthy();
  expect(screen.getByText(purgeSummary(items))).toBeTruthy();
  view.rerender(<Harness rows={items.slice(1)} />);
  fireEvent.click(screen.getByRole('button', { name: '永久删除 3 项' }));
  await waitFor(() => expect(empty).toHaveBeenCalledWith(expect.objectContaining({ expectCount: 3 })));
});

it('失败结果列出名字和原因，并提供只重试失败项的入口', () => {
  render(<BulkFeedback selection={{ report: { succeeded: 1, failed: 1, results: [
    { kind: 'file', id: 'f', title: '报告.pdf', ok: false, error: '文件正在使用' },
  ] }, error: null, canRetry: true, uncertain: false, busy: false, retry: vi.fn() } as never} />);
  expect(screen.getByText(/报告.pdf.*文件正在使用/)).toBeTruthy();
  expect(screen.getByRole('button', { name: '重试 1 项' })).toBeTruthy();
});
