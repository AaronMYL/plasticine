import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../../helpers.tsx';

async function openForm() {
  const app = await renderApp({ hash: '#/settings/ai' });
  fireEvent.click(await screen.findByRole('button', { name: '添加提供商' }));
  const adding = screen.getByRole('region', { name: '添加提供商' });
  fireEvent.click(within(within(adding).getByRole('listitem', { name: '自定义提供商' })).getByRole('button',
    { name: '添加' }));
  return { app, form: await screen.findByRole('form', { name: '自定义提供商' }) };
}

function fill(form: HTMLElement, values: { name?: string; url?: string; key?: string; models?: string[] }): void {
  const set = (label: string, value: string | undefined): void => {
    if (value !== undefined) fireEvent.change(within(form).getByLabelText(label), { target: { value } });
  };
  set('名称', values.name);
  set('Base URL', values.url);
  set('API Key', values.key);
  for (const model of values.models ?? []) {
    const input = within(form).getByLabelText('添加模型');
    fireEvent.change(input, { target: { value: model } });
    fireEvent.keyDown(input, { key: 'Enter' });
  }
}

describe('Custom provider', () => {
  it('filling, testing, and saving adds provider under Connected as Custom with all models enabled', async () => {
    const { app, form } = await openForm();
    const save = within(form).getByRole('button', { name: '保存' });
    expect(save.hasAttribute('disabled')).toBe(true);
    fill(form, { name: 'My Gateway', url: 'https://llm.example.com/v1', key: 'sk-test-only-0001',
      models: ['chat-large', 'chat-fast'] });
    expect(within(form).getByRole('button', { name: '移除 chat-fast' })).toBeTruthy();
    fireEvent.click(within(form).getByRole('button', { name: '测试连接' }));
    const result = await within(form).findByRole('status', { name: '连接正常' });
    expect(within(result).getByText('chat-large 回复了（带图）')).toBeTruthy();
    expect(within(result).getByText('chat-fast 回复了（带图）')).toBeTruthy();
    fireEvent.click(save);
    const connected = await screen.findByRole('list', { name: '连着的提供商' });
    const row = await within(connected).findByRole('listitem', { name: 'My Gateway' });
    expect(within(row).getByText('自定义')).toBeTruthy();
    expect(within(row).getByText('2 个启用')).toBeTruthy();
    const saved = (await app.api.modelProviders.list()).providers.find((item) => item.name === 'My Gateway');
    expect(saved?.custom).toEqual({ baseUrl: 'https://llm.example.com/v1', protocol: 'openai-completions' });
    expect(JSON.stringify(saved).includes('sk-test-only')).toBe(false);
  });

  it('failed test shows reason and raw server message; fetching from API allows selective add', async () => {
    const { form } = await openForm();
    fill(form, { name: 'Bad', url: 'https://llm.example.com/v1', key: 'sk-bad-key-0002', models: ['chat-large'] });
    fireEvent.click(within(form).getByRole('button', { name: '测试连接' }));
    const result = await within(form).findByRole('status', { name: '连接有问题' });
    expect(within(result).getByText('API Key 不对（401）')).toBeTruthy();
    expect(within(result).getByText('Incorrect API key provided')).toBeTruthy();
    fill(form, { key: 'sk-good-key-0003' });
    expect(within(form).queryByRole('status')).toBeNull();
    fireEvent.click(within(form).getByRole('button', { name: '从接口读取' }));
    const listed = await within(form).findByRole('group', { name: '接口列出的模型' });
    fireEvent.click(within(listed).getByRole('button', { name: 'chat-coder' }));
    expect(within(form).getByRole('button', { name: '移除 chat-coder' })).toBeTruthy();
    fireEvent.click(within(listed).getByRole('button', { name: '全部添加' }));
    expect(within(form).getByRole('button', { name: '移除 chat-mini' })).toBeTruthy();
    expect(within(form).getByText('都加上了')).toBeTruthy();
    expect((within(form).getByLabelText('chat-coder 上下文') as HTMLSelectElement).value).toBe('256000');
    expect((within(form).getByLabelText('chat-mini 上下文') as HTMLSelectElement).value).toBe('128000');
  });

  it('model capability tags test accordingly, report unsupported ones, and enable thinking tiers', async () => {
    const { app, form } = await openForm();
    fill(form, { name: 'Flags', url: 'https://llm.example.com/v1', key: 'sk-test-only-0006',
      models: ['chat-large', 'chat-mini'] });
    fireEvent.click(within(form).getByRole('button', { name: 'chat-large 能思考' }));
    fireEvent.click(within(form).getByRole('button', { name: 'chat-mini 能思考' }));
    fireEvent.click(within(form).getByRole('button', { name: 'chat-mini 能看图' }));
    expect(within(form).getByRole('button', { name: 'chat-mini 能看图' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.change(within(form).getByLabelText('chat-large 上下文'), { target: { value: '200000' } });
    fireEvent.click(within(form).getByRole('button', { name: '测试连接' }));
    const result = await within(form).findByRole('status', { name: '连接有问题' });
    expect(within(result).getByText('chat-large 回复了（带图 · 较低思考）')).toBeTruthy();
    expect(within(result).getByText('chat-mini 能回复，但不认思考参数，取消「能思考」')).toBeTruthy();
    fireEvent.click(within(form).getByRole('button', { name: 'chat-mini 能思考' }));
    fireEvent.click(within(form).getByRole('button', { name: '保存' }));
    const connected = await screen.findByRole('list', { name: '连着的提供商' });
    await within(connected).findByRole('listitem', { name: 'Flags' });
    const saved = (await app.api.modelProviders.list()).providers.find((item) => item.name === 'Flags');
    expect(saved?.models.map((model) => [model.id, model.thinkingLevels, model.input, model.contextWindow])).toEqual([
      ['chat-large', ['off', 'low', 'medium', 'high'], ['text', 'image'], 200_000],
      ['chat-mini', ['off'], ['text'], 128_000],
    ]);
  });

  it('invalid model name reports Model name invalid on connection test', async () => {
    const { form } = await openForm();
    fill(form, { name: 'X', url: 'https://llm.example.com/v1', key: 'sk-test-only-0004', models: ['no-such-model'] });
    fireEvent.click(within(form).getByRole('button', { name: '测试连接' }));
    expect(await within(form).findByText('模型名不对：接口说没有「no-such-model」（404）')).toBeTruthy();
  });

  it('menu Edit keeps key when blank and Delete asks for confirmation', async () => {
    const { app, form } = await openForm();
    fill(form, { name: 'Gate', url: 'https://llm.example.com/v1', key: 'sk-test-only-0005', models: ['chat-large'] });
    fireEvent.click(within(form).getByRole('button', { name: '保存' }));
    const connected = await screen.findByRole('list', { name: '连着的提供商' });
    const row = await within(connected).findByRole('listitem', { name: 'Gate' });
    fireEvent.click(within(row).getByRole('button', { name: '管理 Gate' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '编辑' }));
    const edit = await screen.findByRole('form', { name: '自定义提供商' });
    expect((within(edit).getByLabelText('名称') as HTMLInputElement).value).toBe('Gate');
    fill(edit, { name: 'Gate 2', models: ['chat-fast'] });
    fireEvent.click(within(edit).getByRole('button', { name: '保存' }));
    const renamed = await within(connected).findByRole('listitem', { name: 'Gate 2' });
    expect(within(renamed).getByText('2 个启用')).toBeTruthy();
    fireEvent.click(within(renamed).getByRole('button', { name: '管理 Gate 2' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '删除' }));
    const confirm = screen.getByRole('alertdialog', { name: '删除 Gate 2？' });
    fireEvent.click(within(confirm).getByRole('button', { name: '删除' }));
    await waitFor(async () => expect((await app.api.modelProviders.list()).providers
      .some((item) => item.custom !== null)).toBe(false));
  });
});
