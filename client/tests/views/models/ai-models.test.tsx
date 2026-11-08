// 《优化清单》第 13 条「设置 · AI 模型选择」：每家先选启用哪几个；各功能各自从启用的里选；设置、对话框、翻译菜单
// 三处共用一个选择器，在哪里切换都是改这个功能的默认；选到的后来用不了就回到默认，那一行写原因。

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FakeApi } from '../../../src/api/fake/index.ts';
import { renderApp } from '../../helpers.tsx';

function seed(fake: FakeApi): void {
  fake.control.modelProviders.seedConnected([['openai', 'oauth'], ['anthropic', 'api_key']],
    { provider: 'openai', model: 'gpt-5.5', thinking: 'high' });
  fake.control.modelProviders.seedConfig([{ provider: 'openai', models: ['gpt-5.5', 'gpt-5.5-mini'] },
    { provider: 'anthropic', models: ['claude-sonnet-5', 'claude-haiku-5'] }]);
}

async function purposeOf(app: { api: FakeApi['api'] }, purpose: string) {
  return (await app.api.modelProviders.list()).purposes.find((item) => item.purpose === purpose);
}

describe('设置 · AI 模型选择', () => {
  it('每家一行写启用了几个，展开勾选；取消勾选的不再出现在选择器里', async () => {
    const app = await renderApp({ hash: '#/settings/ai', setup: seed });
    const list = await screen.findByRole('list', { name: '连着的提供商' });
    const chatgpt = within(list).getByRole('listitem', { name: 'ChatGPT' });
    expect(within(chatgpt).getByText('2 个启用')).toBeTruthy();
    fireEvent.click(within(chatgpt).getByRole('button', { name: /个启用/ }));
    const models = within(chatgpt).getByRole('list', { name: 'ChatGPT 启用的模型' });
    expect(within(models).getAllByRole('checkbox')).toHaveLength(4);
    fireEvent.click(within(models).getByRole('checkbox', { name: 'GPT-5.5 mini' }));
    await waitFor(async () => expect((await app.api.modelProviders.list()).providers
      .find((item) => item.id === 'openai')?.enabled).toEqual(['gpt-5.5']));
    expect(await within(chatgpt).findByText('1 个启用')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^后台线（子代理）：/ }));
    const chooser = await screen.findByRole('dialog', { name: '后台线（子代理）用的模型' });
    const options = within(chooser).getByRole('listbox', { name: '模型' });
    expect(within(options).queryByRole('option', { name: 'GPT-5.5 mini' })).toBeNull();
    expect(within(options).getByRole('option', { name: 'GPT-5.5' })).toBeTruthy();
    expect(within(options).getByRole('group', { name: 'Claude' })).toBeTruthy();
  });

  it('各用哪个：默认在最上，成组的折成一行点开再分开配，跟默认是浅色；搜功能只留对得上的', async () => {
    await renderApp({ hash: '#/settings/ai', setup: seed });
    const first = await screen.findByRole('button', { name: /^默认：/ });
    expect(first.getAttribute('aria-label')).toBe('默认：GPT-5.5 · 高');
    const notes = screen.getByRole('button', { name: '笔记 · 8 项' });
    expect(notes.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: /^润色：/ })).toBeNull();
    fireEvent.click(notes);
    expect(screen.getByRole('button', { name: /^润色：/ }).getAttribute('data-quiet')).toBe('true');
    expect(screen.queryByRole('button', { name: '旁聊：跟主线' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '主线和旁聊 · 2 项' }));
    expect(screen.getByRole('button', { name: '旁聊：跟主线' })).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox', { name: '搜功能' }), { target: { value: '心跳' } });
    expect(screen.getByRole('button', { name: /^心跳：/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^默认：/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^翻译：/ })).toBeNull();
  });

  it('心跳、做梦没单独设时用默认那一家里启用的最便宜的模型、低档', async () => {
    await renderApp({ hash: '#/settings/ai', setup: seed });
    expect((await screen.findByRole('button', { name: /^心跳：/ })).getAttribute('aria-label'))
      .toBe('心跳：GPT-5.5 mini · 低');
    expect(screen.getByRole('button', { name: /^做梦：/ }).getAttribute('data-quiet')).toBe('true');
  });

  it('选择器：搜模型、按提供商分组、思考只给真支持的档；选了马上存，只改这一个功能', async () => {
    const app = await renderApp({ hash: '#/settings/ai', setup: seed });
    const before = await app.api.modelProviders.list();
    fireEvent.click(await screen.findByRole('button', { name: /^翻译：/ }));
    const chooser = await screen.findByRole('dialog', { name: '翻译用的模型' });
    fireEvent.change(within(chooser).getByRole('searchbox', { name: '搜模型' }), { target: { value: 'haiku' } });
    expect(within(chooser).getAllByRole('option').map((item) => item.textContent)).toEqual(['Claude Haiku 5']);
    fireEvent.click(within(chooser).getByRole('option', { name: 'Claude Haiku 5' }));
    await waitFor(async () => expect((await purposeOf(app, 'translation'))?.chosen)
      .toEqual({ model: { provider: 'anthropic', model: 'claude-haiku-5' }, thinking: null }));
    fireEvent.click(await within(chooser).findByRole('button', { name: '最高' }));
    await waitFor(async () => expect((await purposeOf(app, 'translation'))?.chosen.thinking).toBe('max'));
    const after = await app.api.modelProviders.list();
    expect(after.chosen).toEqual(before.chosen);
    expect(after.purposes.find((item) => item.purpose === 'main'))
      .toEqual(before.purposes.find((item) => item.purpose === 'main'));
    expect(await screen.findByRole('button', { name: '翻译：Claude Haiku 5 · 最高' })).toBeTruthy();
  });

  it('不分思考档的模型不给思考那一栏；改默认的模型和思考在同一个选择器里', async () => {
    const app = await renderApp({ hash: '#/settings/ai', setup: (fake) => {
      seed(fake);
      fake.control.modelProviders.seedConnected([['groq', 'api_key']], { provider: 'openai', model: 'gpt-5.5',
        thinking: 'high' });
      fake.control.modelProviders.seedConfig([{ provider: 'groq', models: ['llama-5-70b'] }]);
    } });
    fireEvent.click(await screen.findByRole('button', { name: /^默认：/ }));
    const chooser = await screen.findByRole('dialog', { name: '默认用的模型' });
    expect(within(chooser).queryByRole('option', { name: '跟默认' })).toBeNull();
    fireEvent.click(within(chooser).getByRole('option', { name: 'Llama 5 70B' }));
    await waitFor(async () => expect((await app.api.modelProviders.list()).chosen)
      .toEqual({ provider: 'groq', model: 'llama-5-70b', thinking: 'off' }));
    expect(within(chooser).queryByRole('group', { name: '思考' })).toBeNull();
  });

  it('选的模型后来取消启用：那一行回到默认并写一句原因', async () => {
    const app = await renderApp({ hash: '#/settings/ai', setup: (fake) => {
      seed(fake);
      fake.control.modelProviders.seedConfig([], { agent: { model: { provider: 'anthropic',
        model: 'claude-sonnet-5' }, thinking: null } });
    } });
    expect((await screen.findByRole('button', { name: /^后台线（子代理）：/ })).getAttribute('aria-label'))
      .toBe('后台线（子代理）：Claude Sonnet 5 · 高');
    const list = screen.getByRole('list', { name: '连着的提供商' });
    const claude = within(list).getByRole('listitem', { name: 'Claude' });
    fireEvent.click(within(claude).getByRole('button', { name: /个启用/ }));
    fireEvent.click(within(claude).getByRole('checkbox', { name: 'Claude Sonnet 5' }));
    const row = await screen.findByRole('button', { name: '后台线（子代理）：跟默认' });
    expect(row.closest('.ai-use')?.textContent).toContain('Claude Sonnet 5 已取消启用，回到默认。');
    expect((await purposeOf(app, 'agent'))?.effective?.model).toBe('gpt-5.5');
  });

  it('对话框里切换：就是改主线的默认，设置里跟着变，别的功能不变', async () => {
    const app = await renderApp({ hash: '#/messages/plasticine', setup: seed });
    const before = await app.api.modelProviders.list();
    fireEvent.click(await screen.findByRole('button', { name: /^对话模型：/ }));
    const chooser = await screen.findByRole('dialog', { name: '对话模型' });
    expect(within(chooser).getByRole('option', { name: '跟默认' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(within(chooser).getByRole('option', { name: 'Claude Sonnet 5' }));
    await waitFor(async () => expect((await purposeOf(app, 'main'))?.chosen)
      .toEqual({ model: { provider: 'anthropic', model: 'claude-sonnet-5' }, thinking: null }));
    expect(await screen.findByRole('button', { name: '对话模型：Claude Sonnet 5 · 高' })).toBeTruthy();
    const after = await app.api.modelProviders.list();
    expect(after.chosen).toEqual(before.chosen);
    expect((await purposeOf(app, 'side'))?.effective?.model).toBe('claude-sonnet-5');
    expect(after.purposes.find((item) => item.purpose === 'translation'))
      .toEqual(before.purposes.find((item) => item.purpose === 'translation'));
  });
});
