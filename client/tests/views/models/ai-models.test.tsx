import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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

describe('Settings - AI model selection', () => {
  it('shows enabled count per provider, expands to toggle, and hides unchecked models from picker', async () => {
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

  it('groups by usage with default in Models, foldable 8 note items, and shared group edit',
    async () => {
      const app = await renderApp({ hash: '#/settings/ai', setup: seed });
      const first = await screen.findByRole('button', { name: /^默认模型：/ });
      expect(first.getAttribute('aria-label')).toBe('默认模型：GPT-5.5 · 较高');
      const pane = within(screen.getByRole('dialog', { name: '设置' }));
      for (const title of ['对话', '例行', '笔记、阅读和资料', '记忆和记账', '工具和技能']) {
        expect(pane.getByRole('region', { name: title })).toBeTruthy();
      }
      const notes = screen.getByRole('button', { name: '笔记 · 8 项' });
      expect(notes.getAttribute('aria-expanded')).toBe('false');
      expect(screen.queryByRole('button', { name: /^润色：/ })).toBeNull();
      fireEvent.click(notes);
      expect(screen.getByRole('button', { name: /^润色：/ }).getAttribute('data-quiet')).toBe('true');
      expect(screen.getByRole('button', { name: '队友：跟主线' })).toBeTruthy();
      const predict = within(pane.getByRole('region', { name: '对话' }));
      expect(predict.getByRole('button', { name: '输入建议：跟续写' })).toBeTruthy();
      expect(predict.getByRole('switch', { name: '输入建议' })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: '信息流：跟默认' }));
      const chooser = await screen.findByRole('dialog', { name: '信息流用的模型' });
      fireEvent.click(within(chooser).getByRole('option', { name: 'Claude Haiku 5' }));
      await waitFor(async () => {
        const purposes = (await app.api.modelProviders.list()).purposes;
        expect(['feed_selection', 'feed_comment'].map((id) => purposes.find((item) => item.purpose === id)
          ?.chosen.model?.model)).toEqual(['claude-haiku-5', 'claude-haiku-5']);
      });
    });

  it('heartbeat and dream default to cheapest enabled model at low tier from default provider', async () => {
    await renderApp({ hash: '#/settings/ai', setup: seed });
    expect((await screen.findByRole('button', { name: /^心跳：/ })).getAttribute('aria-label'))
      .toBe('心跳：GPT-5.5 mini · 较低');
    expect(screen.getByRole('button', { name: /^做梦：/ }).getAttribute('data-quiet')).toBe('true');
  });

  it('picker searches, groups by provider, lists supported thinking tiers, and saves per feature', async () => {
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

  it('hides thinking bar for models without tiers; default model and thinking share one picker', async () => {
    const app = await renderApp({ hash: '#/settings/ai', setup: (fake) => {
      seed(fake);
      fake.control.modelProviders.seedConnected([['groq', 'api_key']], { provider: 'openai', model: 'gpt-5.5',
        thinking: 'high' });
      fake.control.modelProviders.seedConfig([{ provider: 'groq', models: ['llama-5-70b'] }]);
    } });
    fireEvent.click(await screen.findByRole('button', { name: /^默认模型：/ }));
    const chooser = await screen.findByRole('dialog', { name: '默认模型用的模型' });
    expect(within(chooser).queryByRole('option', { name: '跟默认' })).toBeNull();
    fireEvent.click(within(chooser).getByRole('option', { name: 'Llama 5 70B' }));
    await waitFor(async () => expect((await app.api.modelProviders.list()).chosen)
      .toEqual({ provider: 'groq', model: 'llama-5-70b', thinking: 'off' }));
    expect(within(chooser).queryByRole('group', { name: '思考' })).toBeNull();
  });

  it('disabling a selected model falls back to default with explanation', async () => {
    const app = await renderApp({ hash: '#/settings/ai', setup: (fake) => {
      seed(fake);
      fake.control.modelProviders.seedConfig([], { agent: { model: { provider: 'anthropic',
        model: 'claude-sonnet-5' }, thinking: null } });
    } });
    expect((await screen.findByRole('button', { name: /^后台线（子代理）：/ })).getAttribute('aria-label'))
      .toBe('后台线（子代理）：Claude Sonnet 5 · 较高');
    const list = screen.getByRole('list', { name: '连着的提供商' });
    const claude = within(list).getByRole('listitem', { name: 'Claude' });
    fireEvent.click(within(claude).getByRole('button', { name: /个启用/ }));
    fireEvent.click(within(claude).getByRole('checkbox', { name: 'Claude Sonnet 5' }));
    const row = await screen.findByRole('button', { name: '后台线（子代理）：跟默认' });
    expect(row.closest('.ai-use')?.textContent).toContain('Claude Sonnet 5 已取消启用，回到默认。');
    expect((await purposeOf(app, 'agent'))?.effective?.model).toBe('gpt-5.5');
  });

  it('switching in chat box updates main default and Settings without changing other features', async () => {
    const app = await renderApp({ hash: '#/messages/plasticine', setup: seed });
    const before = await app.api.modelProviders.list();
    fireEvent.click(await screen.findByRole('button', { name: /^对话模型：/ }));
    const chooser = await screen.findByRole('dialog', { name: '对话模型' });
    expect(within(chooser).getByRole('option', { name: '跟默认' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(within(chooser).getByRole('option', { name: 'Claude Sonnet 5' }));
    await waitFor(async () => expect((await purposeOf(app, 'main'))?.chosen)
      .toEqual({ model: { provider: 'anthropic', model: 'claude-sonnet-5' }, thinking: null }));
    expect(await screen.findByRole('button', { name: '对话模型：Claude Sonnet 5 · 较高' })).toBeTruthy();
    const after = await app.api.modelProviders.list();
    expect(after.chosen).toEqual(before.chosen);
    expect((await purposeOf(app, 'side'))?.effective?.model).toBe('claude-sonnet-5');
    expect(after.purposes.find((item) => item.purpose === 'translation'))
      .toEqual(before.purposes.find((item) => item.purpose === 'translation'));
  });
  it('image row states honestly when no image-capable login exists without querying image models', async () => {
    const app = await renderApp({ hash: '#/settings/ai', setup: seed });
    const row = (await screen.findByText('来信配图')).closest('.ai-use') as HTMLElement;
    expect(within(row).getByText('没有能出图的登录')).toBeTruthy();
    expect(await app.api.modelProviders.imageModel()).toEqual({ model: null });
  });

  it('image row displays active login and server-reported image model without hardcoding', async () => {
    await renderApp({ hash: '#/settings/ai', setup: (fake) => {
      seed(fake);
      fake.control.modelProviders.seedConnected([['openai', 'api_key']],
        { provider: 'openai', model: 'gpt-5.5', thinking: 'high' });
    } });
    const row = (await screen.findByText('来信配图')).closest('.ai-use') as HTMLElement;
    await waitFor(() => expect(row.textContent).toContain('OpenAI · API key · gpt-image-1'));
  });

  it('image row displays only active login when image model query fails', async () => {
    let asked = 0;
    await renderApp({ hash: '#/settings/ai', setup: (fake) => {
      seed(fake);
      fake.control.modelProviders.seedConnected([['openai', 'api_key']],
        { provider: 'openai', model: 'gpt-5.5', thinking: 'high' });
      vi.spyOn(fake.control.modelProviders, 'imageModel').mockImplementation(async () => {
        asked += 1;
        throw new Error('断网');
      });
    } });
    const row = (await screen.findByText('来信配图')).closest('.ai-use') as HTMLElement;
    await waitFor(() => expect(asked).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(within(row).getByText('OpenAI · API key')).toBeTruthy();
  });
});
