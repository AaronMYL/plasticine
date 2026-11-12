// 模型连接（2026-11-05 设计稿 Connect / Settings-AI；11-12 起一家都没连也不挡整窗）：订阅登录复制链接、贴回调地址；
// 设置 · AI 里平级列出、断开先问一句。

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HOME_HEADING, renderApp } from '../../helpers.tsx';
import { arrangeProviders, choiceLabel, providerName } from '../../../src/views/models/model-store.ts';

describe('连接模型', () => {
  it('一家都没连：不挡整窗，首页照常进（11-12《首次使用解耦》，连模型在主线欢迎卡里、用到时再弹）', async () => {
    await renderApp({ hash: '#/today', modelConnected: false });
    expect(await screen.findByRole('heading', { name: HOME_HEADING })).toBeTruthy();
    expect(screen.queryByRole('main', { name: '连接模型' })).toBeNull();
  });

  it('设置 · AI 里订阅登录：复制登录链接和贴回调地址都常显（Aaron：模型配置一定要有）', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    await renderApp({ hash: '#/settings/ai', modelConnected: false });
    fireEvent.click(await screen.findByRole('button', { name: '添加提供商' }));
    const adding = screen.getByRole('region', { name: '添加提供商' });
    fireEvent.click(within(within(adding).getByRole('listitem', { name: 'ChatGPT' })).getByRole('button',
      { name: '登录' }));
    expect(await screen.findByRole('button', { name: '复制登录链接' })).toBeTruthy();
    expect(screen.getByLabelText('回调地址')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '粘贴回调地址' })).toBeNull();
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

  it('用着的时候一家都断开了：不挡整窗，还在设置里', async () => {
    await renderApp({ hash: '#/settings/ai' });
    const connected = await screen.findByRole('list', { name: '连着的提供商' });
    const chatgpt = within(connected).getByRole('listitem', { name: 'ChatGPT' });
    fireEvent.click(within(chatgpt).getByRole('button', { name: '管理 ChatGPT' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '断开' }));
    const confirm = screen.getByRole('alertdialog', { name: '断开 ChatGPT' });
    fireEvent.click(within(confirm).getByRole('button', { name: '断开' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.queryByRole('main', { name: '连接模型' })).toBeNull();
    expect(screen.getByRole('button', { name: '添加提供商' })).toBeTruthy();
  });

  it('连着但一个模型都没启用：不挡在连接页，照常进（设置 · AI 里再选）', async () => {
    const app = await renderApp({ hash: '#/today' });
    const value = await app.api.modelProviders.list();
    await app.api.modelProviders.saveConfig({ requestId: 'test-none-enabled', version: value.version, purposes: [],
      enabled: value.providers.filter((item) => item.connected !== null)
        .map((item) => ({ provider: item.id, models: [] })) });
    expect(await screen.findByRole('heading', { name: HOME_HEADING })).toBeTruthy();
    expect(screen.queryByRole('main', { name: '连接模型' })).toBeNull();
  });

  it('填 key 连上的那家只露 key 的最后 4 位', async () => {
    const app = await renderApp({ hash: '#/settings/ai' });
    await app.api.modelProviders.setKey('deepseek', 'r-key', 'sk-test-value-7q2w');
    const listed = (await app.api.modelProviders.list()).providers.find((item) => item.id === 'deepseek');
    expect(listed?.keyLast4).toBe('7q2w');
    expect(JSON.stringify(listed).includes('sk-test-value')).toBe(false);
  });

  it('名字、排序和「GPT-5.5 · 较高」', () => {
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
      effective: { provider: 'deepseek', model: 'm', thinking: 'high' } })).toBe('M 1 · 较高');
  });
});
