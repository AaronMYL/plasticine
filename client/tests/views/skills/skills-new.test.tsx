// 技能页 · 新建（11-13）：说一句让 Plasticine 写草稿、从做成过的事里整理、自己写；草稿改完保存才进目录。

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../src/api/errors.ts';
import { renderApp } from '../../helpers.tsx';

async function pane(): Promise<HTMLElement> {
  return screen.findByRole('region', { name: '新建技能' });
}

function field(form: HTMLElement, name: string): HTMLInputElement {
  return within(form).getByRole('textbox', { name }) as HTMLInputElement;
}

describe('技能 · 新建', () => {
  it('说一句 → 写草稿 → 改 → 保存：进目录，去看那个技能', async () => {
    const app = await renderApp({ hash: '#/skills/new' });
    const ask = await pane();
    expect(within(ask).getByRole('button', { name: '写草稿' })).toHaveProperty('disabled', true);
    fireEvent.change(within(ask).getByRole('textbox', { name: '想让 Plasticine 学会什么？' }),
      { target: { value: '每次我发来会议录音的转写，整理成纪要' } });
    fireEvent.click(within(ask).getByRole('button', { name: '写草稿' }));
    const form = await screen.findByRole('form', { name: '技能草稿' });
    expect(within(form).getByText('Plasticine 写的，可以改')).toBeTruthy();
    expect(field(form, '名字').value).toBe('会议纪要');
    expect(field(form, '短名').value).toBe('meeting-notes');
    expect(field(form, '方法').value).toContain('没定下来的单独列成');
    fireEvent.change(field(form, '短名'), { target: { value: 'Meeting Notes' } });
    expect(within(form).getByRole('alert').textContent).toContain('短名只用小写字母、数字和连字符');
    expect(within(form).getByRole('button', { name: '保存' })).toHaveProperty('disabled', true);
    fireEvent.change(field(form, '短名'), { target: { value: 'team-minutes' } });
    fireEvent.change(field(form, '名字'), { target: { value: '组会纪要' } });
    fireEvent.click(within(form).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(window.location.hash).toBe('#/skills/s/team-minutes'));
    const detail = await screen.findByRole('article', { name: '组会纪要' });
    expect(within(detail).getByText('你写的')).toBeTruthy();
    expect((await app.api.skills.list({})).skills.map((skill) => skill.name)).toEqual(['team-minutes']);
  });

  it('草稿没写成：写原因，原来说的那句还在', async () => {
    const app = await renderApp({ hash: '#/skills/new' });
    const ask = await pane();
    app.control.m5b.skills.draft = () => Promise.reject(new ApiError({ kind: 'failed', code: 'upstream_failed',
      status: 502, message: '还没有连接模型，连上以后再让 Plasticine 写；也可以选「自己写」。' }));
    const said = within(ask).getByRole('textbox', { name: '想让 Plasticine 学会什么？' }) as HTMLTextAreaElement;
    fireEvent.change(said, { target: { value: '整理周报' } });
    fireEvent.click(within(ask).getByRole('button', { name: '写草稿' }));
    expect((await within(ask).findByRole('alert')).textContent).toContain('还没有连接模型');
    expect(said.value).toBe('整理周报');
    expect(screen.queryByRole('form', { name: '技能草稿' })).toBeNull();
  });

  it('自己写：空白表单，填全了才能保存；重名说清楚', async () => {
    await renderApp({ hash: '#/skills/new', setup: (fake) => { fake.control.m5b.skills.seedPage(); } });
    const ask = await pane();
    fireEvent.click(within(ask).getByRole('button', { name: '自己写' }));
    const form = await screen.findByRole('form', { name: '技能草稿' });
    expect(within(form).queryByText('Plasticine 写的，可以改')).toBeNull();
    const save = within(form).getByRole('button', { name: '保存' });
    expect(save).toHaveProperty('disabled', true);
    fireEvent.change(field(form, '短名'), { target: { value: 'video-parse' } });
    fireEvent.change(field(form, '什么时候用'), { target: { value: '收到视频链接的时候' } });
    fireEvent.change(field(form, '方法'), { target: { value: '1. 先转写。' } });
    expect(save).toHaveProperty('disabled', false);
    fireEvent.click(save);
    expect((await within(form).findByRole('alert')).textContent).toContain('和随应用提供的技能重名了');
    expect(window.location.hash).toBe('#/skills/new');
  });

  it('保存并试一次：存好以后把一句话放进主线的输入框，不替你发', async () => {
    const app = await renderApp({ hash: '#/skills/new' });
    const ask = await pane();
    fireEvent.change(within(ask).getByRole('textbox', { name: '想让 Plasticine 学会什么？' }),
      { target: { value: '整理会议纪要' } });
    fireEvent.click(within(ask).getByRole('button', { name: '写草稿' }));
    const form = await screen.findByRole('form', { name: '技能草稿' });
    fireEvent.click(within(form).getByRole('button', { name: '保存并试一次' }));
    await waitFor(() => expect(window.location.hash).toBe('#/plasticine'));
    const input = await screen.findByRole('textbox', { name: '问一句' });
    await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe('用「会议纪要」这个技能试一次：'));
    expect((await app.api.skills.list({})).total).toBe(1);
  });

  it('不要了：草稿里有字先问一句（丢了找不回来），确认才走', async () => {
    await renderApp({ hash: '#/skills/new' });
    const ask = await pane();
    fireEvent.click(within(ask).getByRole('button', { name: '自己写' }));
    const form = await screen.findByRole('form', { name: '技能草稿' });
    fireEvent.change(field(form, '名字'), { target: { value: '草稿' } });
    fireEvent.click(within(form).getByRole('button', { name: '不要了' }));
    const confirm = within(form).getByRole('alertdialog', { name: '不要这份草稿' });
    expect(confirm.textContent).toContain('丢了找不回来');
    expect(window.location.hash).toBe('#/skills/new');
    fireEvent.click(within(confirm).getByRole('button', { name: '不要了' }));
    await waitFor(() => expect(window.location.hash).toBe('#/skills'));
  });
});
