import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HOME_HEADING, renderApp } from '../../helpers.tsx';
import { arrangeProviders, choiceLabel, providerName } from '../../../src/views/models/model-store.ts';

describe('Connect model', () => {
  it('no connected provider does not block window; home loads and connect prompts on demand', async () => {
    await renderApp({ hash: '#/today', modelConnected: false });
    expect(await screen.findByRole('heading', { name: HOME_HEADING })).toBeTruthy();
    expect(screen.queryByRole('main', { name: '连接模型' })).toBeNull();
  });

  it('subscription login in Settings - AI always shows copy login URL and paste callback URL', async () => {
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

  it('Settings - AI shows sub vs key for connected, flat list under Add provider, confirms disconnect', async () => {
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
    const confirm = screen.getByRole('alertdialog', { name: '断开 ChatGPT？' });
    fireEvent.click(within(confirm).getByRole('button', { name: '断开' }));
    await waitFor(async () => expect((await app.api.modelProviders.list()).providers
      .find((item) => item.id === 'openai')?.connected).toBeNull());
  });

  it('disconnecting last provider while in use stays in Settings without blocking whole window', async () => {
    await renderApp({ hash: '#/settings/ai' });
    const connected = await screen.findByRole('list', { name: '连着的提供商' });
    const chatgpt = within(connected).getByRole('listitem', { name: 'ChatGPT' });
    fireEvent.click(within(chatgpt).getByRole('button', { name: '管理 ChatGPT' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '断开' }));
    const confirm = screen.getByRole('alertdialog', { name: '断开 ChatGPT？' });
    fireEvent.click(within(confirm).getByRole('button', { name: '断开' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.queryByRole('main', { name: '连接模型' })).toBeNull();
    expect(screen.getByRole('button', { name: '添加提供商' })).toBeTruthy();
  });

  it('connected provider with zero enabled models enters app normally instead of blocking', async () => {
    const app = await renderApp({ hash: '#/today' });
    const value = await app.api.modelProviders.list();
    await app.api.modelProviders.saveConfig({ requestId: 'test-none-enabled', version: value.version, purposes: [],
      enabled: value.providers.filter((item) => item.connected !== null)
        .map((item) => ({ provider: item.id, models: [] })) });
    expect(await screen.findByRole('heading', { name: HOME_HEADING })).toBeTruthy();
    expect(screen.queryByRole('main', { name: '连接模型' })).toBeNull();
  });

  it('API key provider displays only last 4 characters of key', async () => {
    const app = await renderApp({ hash: '#/settings/ai' });
    await app.api.modelProviders.setKey('deepseek', 'r-key', 'sk-test-value-7q2w');
    const listed = (await app.api.modelProviders.list()).providers.find((item) => item.id === 'deepseek');
    expect(listed?.keyLast4).toBe('7q2w');
    expect(JSON.stringify(listed).includes('sk-test-value')).toBe(false);
  });

  it('formats model names, ordering, and GPT-5.5 - High label', () => {
    expect(providerName({ id: 'openai', name: 'OpenAI' })).toBe('ChatGPT');
    expect(providerName({ id: 'groq', name: 'Groq' })).toBe('Groq');
    const provider = (id: string, connected: 'oauth' | null = null) => ({ id, name: id, methods: ['api_key' as const],
      loginLabel: null, connected, account: null, plan: null, keyLast4: null,
      models: [{ id: 'm', name: 'M 1', contextWindow: 1, reasoning: true,
        thinkingLevels: ['high' as const], input: ['text' as const] }], enabled: ['m'], custom: null });
    const { featured, more } = arrangeProviders([provider('groq'), provider('deepseek'), provider('mistral', 'oauth')]);
    expect(featured.map((item) => item.id)).toEqual(['deepseek', 'mistral']);
    expect(more.map((item) => item.id)).toEqual(['groq']);
    expect(choiceLabel({ providers: [provider('deepseek', 'oauth')], chosen: null,
      version: 0, purposes: [], defaultIssue: null,
      effective: { provider: 'deepseek', model: 'm', thinking: 'high' } })).toBe('M 1 · 较高');
  });
});
