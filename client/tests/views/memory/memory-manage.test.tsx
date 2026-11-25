import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FakeApi } from '../../../src/api/fake/index.ts';
import { renderApp } from '../../helpers.tsx';

function seed(fake: FakeApi): void {
  fake.control.memoryTopics.seed();
}

function main(): HTMLElement {
  return screen.getByRole('main');
}

async function lineTexts(app: { api: FakeApi['api'] }, id: string): Promise<string[]> {
  const doc = await app.api.memoryTopics.get(id);
  return doc.sections.flatMap((section) => section.lines.map((line) => line.text));
}

async function menu(text: RegExp): Promise<void> {
  fireEvent.click(await within(main()).findByRole('button', { name: text }));
}

describe('Memory page - edit, delete, move, add', () => {
  it('inline edit saves immediately and delete asks for confirmation first', async () => {
    const app = await renderApp({ hash: '#/memory/topics/t_you', setup: seed });
    const before = await lineTexts(app, 't_you');
    const first = before[0]!;
    await menu(new RegExp(`^「${Array.from(first).slice(0, 12).join('').replace(/[()[\]?.*+^$|\\]/g, '\\$&')}」的更多操作`));
    fireEvent.click(await screen.findByRole('menuitem', { name: '修改' }));
    const box = within(main()).getByRole('textbox', { name: '改这一条' });
    fireEvent.change(box, { target: { value: '住在成都，晚上写代码。' } });
    fireEvent.click(within(main()).getByRole('button', { name: '保存' }));
    expect(await within(main()).findByText('住在成都，晚上写代码。')).toBeTruthy();
    await menu(/^「住在成都，晚上写代码。」的更多操作/);
    fireEvent.click(await screen.findByRole('menuitem', { name: '删除' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '删除' }));
    await waitFor(() => expect(within(main()).queryByText('住在成都，晚上写代码。')).toBeNull());
    expect(await lineTexts(app, 't_you')).toHaveLength(before.length - 1);
  });

  it('moving transfers item to end of target page; bottom action adds new item', async () => {
    const app = await renderApp({ hash: '#/memory/topics/t_personal', setup: seed });
    const [first] = await lineTexts(app, 't_personal');
    await menu(/的更多操作$/);
    fireEvent.click(await screen.findByRole('menuitem', { name: '挪到…' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '关于你' }));
    await waitFor(async () => expect(await lineTexts(app, 't_you')).toContain(first));
    expect(await lineTexts(app, 't_personal')).not.toContain(first);
    fireEvent.click(within(main()).getByRole('button', { name: '加一条' }));
    fireEvent.change(within(main()).getByRole('textbox', { name: '加一条记忆' }), { target: { value: '周末去爬山。' } });
    fireEvent.click(within(main()).getByRole('button', { name: '保存' }));
    expect(await within(main()).findByText('周末去爬山。')).toBeTruthy();
  });
});

describe('Full curation', () => {
  it('Full curation opens checklist all checked by default; unchecking skips item while applying rest', async () => {
    const app = await renderApp({ hash: '#/memory', setup: seed });
    const overview = await within(main()).findByRole('region', { name: '总览' });
    expect(within(overview).queryByRole('button', { name: '全量整理' })).toBeNull();
    const head = main().querySelector<HTMLElement>('.page-head');
    if (head === null) throw new Error('记忆页没有页头');
    expect(within(head).getByRole('searchbox', { name: '搜记忆，含归档' })).toBeTruthy();
    fireEvent.click(within(head).getByRole('button', { name: '全量整理' }));
    await waitFor(() => expect(window.location.hash).toBe('#/memory/cleanup'));
    const items = await within(main()).findAllByRole('checkbox', { name: /^采用：/ });
    expect(items.length).toBe(3);
    const archive = within(main()).getByRole('checkbox', { name: '采用：归档' });
    fireEvent.click(archive);
    const plasticineBefore = await lineTexts(app, 't_plasticine');
    fireEvent.click(within(main()).getByRole('button', { name: '采用这 2 条' }));
    expect(await within(main()).findByText(/改了 2 条/)).toBeTruthy();
    expect(await lineTexts(app, 't_plasticine')).toEqual(plasticineBefore);
    expect((await app.api.memoryTopics.cleanup()).cleanup?.status).toBe('done');
  });
});
