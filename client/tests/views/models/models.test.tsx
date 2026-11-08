// 模型连接（2026-11-05 设计稿 Connect / Settings-AI）：一家都没连时先连模型；填 key 连上、「开始用」进门；订阅登录交回调地址；
// 设置 · AI 里平级列出、断开先问一句。

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HOME_HEADING, renderApp } from '../../helpers.tsx';
import { arrangeProviders, choiceLabel, providerName } from '../../../src/views/models/model-store.ts';

describe('连接模型', () => {
  it('一家都没连：整个窗口只有「连接模型」；填 key 连上后「开始用」进首页', async () => {
    await renderApp({ hash: '#/today', modelConnected: false });
    const page = await screen.findByRole('main', { name: '连接模型' });
    expect(within(page).getByText('ChatGPT')).toBeTruthy();
    const deepseek = within(page).getByRole('listitem', { name: 'DeepSeek' });
    fireEvent.click(within(deepseek).getByRole('button', { name: '填 key' }));
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-test-12345678' } });
    fireEvent.click(screen.getByRole('button', { name: '连接' }));
    expect(await screen.findByRole('img', { name: '已连接' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '开始用' }));
    expect(await screen.findByRole('heading', { name: HOME_HEADING })).toBeTruthy();
  });

  it('订阅登录：开授权页，浏览器没跳回来时贴回调地址，连上', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const app = await renderApp({ hash: '#/today', modelConnected: false });
    const page = await screen.findByRole('main', { name: '连接模型' });
    fireEvent.click(within(within(page).getByRole('listitem', { name: 'ChatGPT' })).getByRole('button',
      { name: '登录' }));
    expect(await screen.findByText('在浏览器里登录 ChatGPT…')).toBeTruthy();
    await waitFor(() => expect(open).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('回调地址'),
      { target: { value: 'http://localhost:1455/auth/callback?code=x' } });
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    expect(await screen.findByRole('img', { name: '已连接' })).toBeTruthy();
    expect((await app.api.modelProviders.list()).providers.find((item) => item.id === 'openai')?.connected)
      .toBe('oauth');
  });

  it('设置 · AI：连着的每家一行写订阅还是 key；没连的在「添加提供商」里平级列出；断开先问一句', async () => {
    const app = await renderApp({ hash: '#/settings/ai' });
    const connected = await screen.findByRole('list', { name: '连着的提供商' });
    const chatgpt = within(connected).getByRole('listitem', { name: 'ChatGPT' });
    expect(within(chatgpt).getByText('订阅')).toBeTruthy();
    expect(within(connected).queryByRole('listitem', { name: 'DeepSeek' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '添加提供商' }));
    const adding = screen.getByRole('region', { name: '添加提供商' });
    expect(within(adding).getByRole('listitem', { name: 'DeepSeek' })).toBeTruthy();
    expect(within(adding).queryByRole('listitem', { name: 'ChatGPT' })).toBeNull();
    fireEvent.click(within(chatgpt).getByRole('button', { name: '管理 ChatGPT' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '断开' }));
    const confirm = screen.getByRole('alertdialog', { name: '断开 ChatGPT' });
    fireEvent.click(within(confirm).getByRole('button', { name: '断开' }));
    await waitFor(async () => expect((await app.api.modelProviders.list()).providers
      .find((item) => item.id === 'openai')?.connected).toBeNull());
  });

  it('填 key 连上的那家只露 key 的最后 4 位', async () => {
    const app = await renderApp({ hash: '#/settings/ai' });
    await app.api.modelProviders.setKey('deepseek', 'r-key', 'sk-test-value-7q2w');
    const listed = (await app.api.modelProviders.list()).providers.find((item) => item.id === 'deepseek');
    expect(listed?.keyLast4).toBe('7q2w');
    expect(JSON.stringify(listed).includes('sk-test-value')).toBe(false);
  });

  it('名字、排序和「GPT-5.5 · 高」', () => {
    expect(providerName({ id: 'openai', name: 'OpenAI' })).toBe('ChatGPT');
    expect(providerName({ id: 'groq', name: 'Groq' })).toBe('Groq');
    const provider = (id: string, connected: 'oauth' | null = null) => ({ id, name: id, methods: ['api_key' as const],
      loginLabel: null, connected, account: null, plan: null, keyLast4: null,
      models: [{ id: 'm', name: 'M 1', contextWindow: 1, reasoning: true,
        thinkingLevels: ['high' as const], input: ['text' as const] }], enabled: ['m'] });
    const { featured, more } = arrangeProviders([provider('groq'), provider('deepseek'), provider('mistral', 'oauth')]);
    expect(featured.map((item) => item.id)).toEqual(['deepseek', 'mistral']);
    expect(more.map((item) => item.id)).toEqual(['groq']);
    expect(choiceLabel({ providers: [provider('deepseek', 'oauth')], chosen: null,
      version: 0, purposes: [], defaultIssue: null,
      effective: { provider: 'deepseek', model: 'm', thinking: 'high' } })).toBe('M 1 · 高');
  });
});
