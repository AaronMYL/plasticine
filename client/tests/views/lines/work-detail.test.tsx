import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FakeApi } from '../../../src/api/fake/index.ts';
import { seedWorkScene } from '../../../src/api/fake/work-seed.ts';
import type { LineMessageView, LineView } from '../../../src/api/shared.ts';
import { NOW, renderApp } from '../../helpers.tsx';

function seed(fake: FakeApi, extra: Partial<LineView> = {}): void {
  fake.control.lines.put(fake.control.lines.blank('work-one', 'background', '检查安装来源', {
    status: 'paused', pauseReason: 'user', outcome: 'stopped', ...extra,
  }));
  const message = (role: LineMessageView['role'], text: string): Omit<LineMessageView, 'lineId' | 'seq'> => ({
    role, text, origin: null, thinking: null, thinkingMs: null, steps: [], toolCallId: null, tool: null,
    say: null, ok: null,
    summary: null, stopReason: role === 'assistant' ? 'stop' : null, childLineId: null, attachments: [], widgets: [],
    createdAt: NOW.toISOString(),
  });
  fake.control.lines.record('work-one', message('user', '模型整理过的任务要求'));
  fake.control.lines.record('work-one', message('assistant', '完整结论。\n\n最后一段不会被预览长度截掉。'));
}

async function open(extra: Partial<LineView> = {}, width = 1440) {
  const app = await renderApp({ width, setup: (fake) => seed(fake, extra) });
  const doing = await screen.findByRole('region', { name: '在做' });
  fireEvent.click(within(doing).getByRole('button', { name: /查看工作：检查安装来源/ }));
  const detail = await screen.findByRole('dialog', { name: '工作详情' });
  await within(detail).findByRole('heading', { name: '检查安装来源' });
  return { ...app, detail };
}

describe('Unified work detail', () => {
  it('shows task request and full result without labeling model-rewritten request as user quote', async () => {
    const { detail } = await open();
    expect(await within(detail).findByRole('heading', { name: '任务要求' })).toBeTruthy();
    expect(within(detail).queryByRole('button', { name: '查看原话' })).toBeNull();
    expect(await within(detail).findByText('最后一段不会被预览长度截掉。')).toBeTruthy();
  });

  it('follow-up while paused does not auto-run; resume processes queue and keeps draft until success', async () => {
    const { detail, control } = await open();
    const input = await within(detail).findByRole('textbox', { name: '补充这件事' });
    fireEvent.change(input, { target: { value: '再看看有没有开机自启' } });
    fireEvent.click(within(detail).getByRole('button', { name: '发送补充' }));
    await within(detail).findByText('1 条修改待处理，继续后执行');
    expect(control.lines.find('work-one')?.pauseReason).toBe('user');
    fireEvent.click(within(detail).getByRole('button', { name: '继续' }));
    await waitFor(() => expect(control.lines.find('work-one')?.outcome).toBe('done'));
  });

  it('truncated output keeps content with continue option; mobile detail fills screen hiding tab bar', async () => {
    const { detail } = await open({ pauseReason: 'output_limit', outcome: 'incomplete' }, 390);
    expect(await within(detail).findByText('本次输出还没写完，已有内容已保留')).toBeTruthy();
    expect(within(detail).getByRole('button', { name: '继续生成' })).toBeTruthy();
    expect(detail.classList.contains('work-sheet')).toBe(true);
    expect(screen.queryByRole('navigation', { name: '主导航' })).toBeNull();
  });

  it('refresh failure keeps result and in-progress follow-up; retry does not clear draft', async () => {
    const { detail, api, control } = await open();
    await within(detail).findByText('最后一段不会被预览长度截掉。');
    const input = within(detail).getByRole('textbox', { name: '补充这件事' }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '这句还没发出' } });
    const read = api.lines.details.bind(api.lines);
    api.lines.details = async () => { throw new Error('暂时连不上'); };
    act(() => control.bus.emit({ type: 'resync' }));
    await within(detail).findByText('刷新失败，保留上次内容');
    expect(within(detail).getByText('最后一段不会被预览长度截掉。')).toBeTruthy();
    expect(input.value).toBe('这句还没发出');
    api.lines.details = read;
    fireEvent.click(within(detail).getByRole('button', { name: '再读一次' }));
    await waitFor(() => expect(within(detail).queryByText('刷新失败，保留上次内容')).toBeNull());
    expect(input.value).toBe('这句还没发出');
  });

  it('verified original quote is viewable and rewritten result reads separately from old version', async () => {
    await renderApp({ hash: '#/work/line-work', setup: ({ control }) => {
      seedWorkScene({ lines: control.lines, asks: control.asks, contacts: control.contacts, projectId: null },
        NOW, 'done');
    } });
    const detail = await screen.findByRole('dialog', { name: '工作详情' });
    fireEvent.click(await within(detail).findByRole('button', { name: '查看原话' }));
    expect(within(detail).getByLabelText('用户原话').textContent).toContain('来源这个慢慢查，查完告诉我');
    fireEvent.click(within(detail).getByRole('button', { name: '历史版本' }));
    const history = within(detail).getByLabelText('历史版本');
    fireEvent.click(history.querySelector('summary')!);
    expect(within(history).getByText('已找到应用签名，安装时间还需要核对。')).toBeTruthy();
    expect(within(history).queryByText(/安装来源与现有记录一致/)).toBeNull();
  });
});

it('archiving an open detail keeps result but hides continue and follow-up controls', async () => {
  const { detail, control } = await open();
  await act(async () => {
    control.lines.change('work-one', { archivedAt: NOW.toISOString() });
  });
  expect(await within(detail).findByText('已删除')).toBeTruthy();
  expect(within(detail).queryByRole('button', { name: '继续' })).toBeNull();
  expect(within(detail).queryByRole('textbox', { name: '补充这件事' })).toBeNull();
  expect(within(detail).getByText('最后一段不会被预览长度截掉。')).toBeTruthy();
});
