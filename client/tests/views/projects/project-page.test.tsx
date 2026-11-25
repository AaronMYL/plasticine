import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { briefRows } from '../../../src/views/projects/project-brief.ts';
import { dueText, todosOf } from '../../../src/views/projects/project-todos.ts';
import { isAiFolder, isAiNote } from '../../../src/views/notes/ai-folder.ts';
import { renderApp } from '../../helpers.tsx';

describe('Project page', () => {
  it('splits dossier lines by custom label, skips blanks, and appends chat decisions with quotes', () => {
    expect(briefRows({ goal: '是什么：任务平台\n先做：让对方的 AI 办件事', constraints: '运营不放国内', rules: '',
      terms: '' })).toEqual([
      { key: 'goal-0', label: '是什么', value: '任务平台' },
      { key: 'goal-1', label: '先做', value: '让对方的 AI 办件事' },
      { key: 'constraints-0', label: '约束', value: '运营不放国内' },
    ]);
    const empty = { goal: '', constraints: '', rules: '', terms: '' };
    expect(briefRows(empty, [{ id: 'd1', text: '开源：先公开代码', quoteRef: 'line:line-main:4', at: '2026-11-05T00:00:00Z' },
      { id: 'd2', text: '每周日发现状', quoteRef: null, at: '2026-11-05T00:00:00Z' }])).toEqual([
      { key: 'decision-d1', label: '开源', value: '先公开代码', quoteRef: 'line:line-main:4' },
      { key: 'decision-d2', label: '定了', value: '每周日发现状' },
    ]);
  });

  it('sorts incomplete todos by nearest due date, undated next, done last; formats Today/Tomorrow/M-D', () => {
    const at = '2026-11-05T00:00:00Z';
    const todo = (id: string, due: string | null, doneAt: string | null = null) => ({ id, title: id, due,
      dueInDays: null, doneAt, createdAt: at });
    expect(todosOf({ todos: [todo('done', '2026-11-01', at), todo('later', null), todo('soon', '2026-11-06'),
      todo('sooner', '2026-11-05')] }).map((row) => row.id)).toEqual(['sooner', 'soon', 'later', 'done']);
    expect(dueText('2026-11-06', '2026-11-05')).toBe('明天');
    expect(dueText('2026-11-05', '2026-11-05')).toBe('今天');
    expect(dueText('2026-11-30', '2026-11-05')).toBe('11-30');
  });

  it('toggles todo completion, adds todo with due date, and links dossier decisions to original quote', async () => {
    const app = await renderApp({ hash: '#/projects/project_hunter', seed: true });
    const todos = await screen.findByRole('region', { name: '待办' });
    fireEvent.click(within(todos).getByRole('checkbox', { name: '做完了：域名解析' }));
    await waitFor(async () => expect((await app.api.projects.get('project_hunter', {})).todos
      .find((row) => row.title === '域名解析')?.doneAt).not.toBeNull());
    await waitFor(() => expect((within(screen.getByRole('region', { name: '待办' }))
      .getByRole('checkbox', { name: '做完了：域名解析' }) as HTMLInputElement).checked).toBe(true));
    fireEvent.click(within(screen.getByRole('region', { name: '待办' })).getByRole('button', { name: '加一条待办' }));
    fireEvent.change(screen.getByRole('textbox', { name: '待办' }), { target: { value: '写邀请信' } });
    fireEvent.change(screen.getByLabelText('期限'), { target: { value: '2026-11-20' } });
    fireEvent.submit(screen.getByRole('textbox', { name: '待办' }));
    expect(await within(screen.getByRole('region', { name: '待办' })).findByText('写邀请信')).toBeTruthy();
    expect((await app.api.projects.get('project_hunter', {})).todos.find((row) => row.title === '写邀请信')?.due)
      .toBe('2026-11-20');
    const profile = screen.getByRole('region', { name: '档案' });
    expect(within(profile).getByText('放腾讯云，只转加密字节')).toBeTruthy();
    expect(within(profile).getByRole('link', { name: '原话：先公开代码' }).getAttribute('href'))
      .toBe('#/conversation/line%3Aline-main%3A1');
  });

  it('uses actual delivery status without marking incomplete/stopped as done; row opens work detail', async () => {
    await renderApp({ hash: '#/projects/project_hunter', seed: true, setup: ({ control }) => {
      for (const [id, title, outcome] of [['partial', '未写完的材料', 'incomplete'],
        ['stopped', '停下的核对', 'stopped'], ['done', '已交付的材料', 'done']] as const) {
        control.lines.put(control.lines.blank(id, 'background', title, {
          projectId: 'project_hunter', status: 'idle', outcome, pauseReason: null,
        }));
      }
    } });
    const project = await screen.findByRole('region', { name: '这个项目的线' });
    const partial = within(project).getByRole('button', { name: '查看工作：未写完的材料' });
    expect(within(partial).getByText('输出未完')).toBeTruthy();
    expect(within(within(project).getByRole('button', { name: '查看工作：停下的核对' }))
      .getByText('已停止')).toBeTruthy();
    expect(within(within(project).getByRole('button', { name: '查看工作：已交付的材料' }))
      .getByText('已完成')).toBeTruthy();
    fireEvent.click(partial);
    expect(await screen.findByRole('dialog', { name: '工作详情' })).toBeTruthy();
  });
});

describe('Written by Plasticine badge', () => {
  it('marks note with star when in Plasticine folder or last edited by Plasticine', () => {
    expect(isAiFolder('Plasticine 写的')).toBe(true);
    expect(isAiNote({ folder: '笔记', author: 'ai' })).toBe(true);
    expect(isAiNote({ folder: '笔记', author: 'user' })).toBe(false);
  });
});
