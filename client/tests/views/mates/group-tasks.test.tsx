import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { renderApp } from '../../helpers.tsx';
import { createRequestId } from '../../../src/api/request-id.ts';
import type { LineView } from '../../../src/api/shared.ts';

async function setup() {
  const app = await renderApp({ hash: '#/plasticine/main' });
  const make = (name: string) => app.api.mates.create({ requestId: createRequestId(), name,
    avatar: '研', hue: 'sky', role: '核对资料', soul: '', purpose: null });
  const [first, second, outside] = await act(() => Promise.all([make('研究员'), make('编辑队友'), make('组外队友')]));
  const group = await act(() => app.api.mateGroups.create({ requestId: createRequestId(), name: '资料小组',
    mateIds: [first.id, second.id] }));
  act(() => { window.location.hash = `#/plasticine/group/${group.id}`; });
  await screen.findByText('你和 2 位队友');
  return { ...app, first, second, outside, group };
}

it('群组发布待领任务，原始全文交给组内队友；普通后台不会变成任务卡', async () => {
  const app = await setup();
  act(() => app.control.lines.put(app.control.lines.blank('ordinary-job', 'background', '普通后台工作',
    { parentLineId: app.group.lineId, mateGroupId: app.group.id, status: 'paused' })));
  fireEvent.click(screen.getByRole('button', { name: '分工' }));
  fireEvent.click(await screen.findByRole('button', { name: '发布任务' }));
  const dialog = screen.getByRole('dialog', { name: '发布群任务' });
  const goal = '检查三条来源\n逐条记录出处，并说明证据缺口。';
  fireEvent.change(within(dialog).getByLabelText('任务内容'), { target: { value: goal } });
  fireEvent.click(within(dialog).getByRole('button', { name: '发布任务' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '发布群任务' })).toBeNull());
  const panel = screen.getByRole('complementary', { name: '群组分工' });
  const card = await within(panel).findByRole('article', { name: '任务：检查三条来源' });
  expect(within(card).getByText('全群待领')).toBeTruthy();
  expect(screen.queryByRole('article', { name: '任务：普通后台工作' })).toBeNull();
  const claim = vi.spyOn(app.api.mates, 'handoff');
  fireEvent.click(within(card).getByRole('button', { name: '选择领取队友' }));
  expect(screen.queryByRole('menuitem', { name: '组外队友领取' })).toBeNull();
  fireEvent.click(screen.getByRole('menuitem', { name: '研究员领取' }));
  await waitFor(() => expect(claim).toHaveBeenCalledOnce());
  const tasks = await app.api.mateGroups.listTasks(app.group.id);
  expect(claim.mock.calls[0]?.[0]).toMatchObject({ sourceLineId: tasks.lines[0]!.id,
    groupId: app.group.id, mateId: app.first.id, goal });
  await waitFor(() => expect(within(card).getByText('研究员接了')).toBeTruthy());
  expect(within(card).queryByRole('button', { name: '选择领取队友' })).toBeNull();
  expect(tasks.lines).toHaveLength(1);
});

it.each([
  [{ status: 'paused', outcome: 'stopped', lastAnswer: '尚未完成的草稿' }, false],
  [{ status: 'failed', outcome: 'failed', failure: '资料读取失败' }, false],
  [{ status: 'idle', outcome: 'done', unmet: '还缺原文', lastAnswer: '尚未完成的草稿' }, false],
  [{ status: 'idle', outcome: 'done', unmet: null, lastAnswer: '三条来源已核对，第二条缺少原始记录。' }, true],
] as const)('任务按真实状态展示交付：%j', async (patch, delivered) => {
  const app = await setup();
  const { line } = await act(() => app.api.mateGroups.createTask(app.group.id,
    { requestId: createRequestId(), text: '核对来源' }));
  act(() => app.control.lines.put({ ...line, ...patch, mateId: app.first.id, queued: 0 } as LineView));
  const card = await screen.findByRole('article', { name: '任务：核对来源' });
  await waitFor(() => expect(within(card).queryByText('已交付') !== null).toBe(delivered));
  expect(within(card).queryByText('尚未完成的草稿')).toBeNull();
  if (delivered) expect(within(card).getByText('三条来源已核对，第二条缺少原始记录。')).toBeTruthy();
});

it('待领任务的原目标未读到时不调用交接接口', async () => {
  const app = await setup();
  const { line } = await act(() => app.api.mateGroups.createTask(app.group.id,
    { requestId: createRequestId(), text: '核对来源' }));
  const original = app.api.lines.read.bind(app.api.lines);
  vi.spyOn(app.api.lines, 'read').mockImplementation(async (id, query) => {
    const result = await original(id, query);
    return id === line.id ? { ...result, queue: [] } : result;
  });
  const claim = vi.spyOn(app.api.mates, 'handoff');
  const card = await screen.findByRole('article', { name: '任务：核对来源' });
  fireEvent.click(within(card).getByRole('button', { name: '选择领取队友' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '研究员领取' }));
  expect((await within(card).findByRole('alert')).textContent).toContain('任务原文');
  expect(claim).not.toHaveBeenCalled();
});
