import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../../helpers.tsx';
import { TRANSLATE_SETTINGS_CHANGED } from '../../../src/shell/web-translate-context.tsx';

async function openSection() {
  const app = await renderApp({ hash: '#/device' });
  fireEvent.click(within(screen.getByRole('navigation', { name: '栏目' })).getByRole('button', { name: /^设置/ }));
  fireEvent.click(within(await screen.findByRole('dialog', { name: '设置' })).getByRole('button', { name: '浏览器' }));
  const section = await screen.findByRole('region', { name: '网页翻译' });
  await within(section).findByRole('combobox', { name: '翻译成' });
  return { app, section };
}

describe('设置 · 浏览器 · 网页翻译', () => {
  it('模型集中在 AI 设置，翻译成中文、双语对照、用词表开着，总是翻译的网站一个一个列出来', async () => {
    const { section } = await openSection();
    expect(within(section).queryByRole('combobox', { name: '翻译模型' })).toBeNull();
    expect((within(section).getByRole('combobox', { name: '翻译成' }) as HTMLSelectElement).value).toBe('zh-CN');
    expect(within(section).getByRole('button', { name: '双语对照' }).getAttribute('aria-pressed')).toBe('true');
    expect((within(section).getByRole('switch', { name: '用词表' }) as HTMLInputElement).checked).toBe(true);
    const sites = within(section).getByRole('list', { name: '总是翻译' });
    expect(within(sites).getAllByRole('listitem').map((item) => item.textContent))
      .toEqual(['field-notes.dev', 'news.ycombinator.com', 'x.com']);
  });

  it('改完点保存：语言与显示存上，存完通知壳重新读；拿掉的网站不再总是翻译', async () => {
    const { app, section } = await openSection();
    let changed = 0;
    window.addEventListener(TRANSLATE_SETTINGS_CHANGED, () => { changed += 1; });
    fireEvent.change(within(section).getByRole('combobox', { name: '翻译成' }), { target: { value: 'ja' } });
    fireEvent.click(within(section).getByRole('button', { name: '只看译文' }));
    fireEvent.click(within(section).getByRole('switch', { name: '用词表' }));
    fireEvent.click(within(section).getByRole('button', { name: '不再总是翻译 x.com' }));
    fireEvent.click(within(section).getByRole('button', { name: '保存网页翻译' }));
    await within(section).findByRole('status');
    expect(await app.api.translate.settings()).toMatchObject({ target: 'ja', display: 'translation', glossary: false,
      alwaysSites: ['field-notes.dev', 'news.ycombinator.com'] });
    expect(changed).toBe(1);
  });

  it('别处先改过：保存报冲突、草稿留着，重新读取后才换成新的', async () => {
    const { app, section } = await openSection();
    fireEvent.click(within(section).getByRole('switch', { name: '用词表' }));
    const current = await app.api.translate.settings();
    await app.api.translate.saveSettings({ ...current, target: 'en' });
    fireEvent.click(within(section).getByRole('button', { name: '保存网页翻译' }));
    expect((await within(section).findByRole('alert')).textContent).toContain('重新读取');
    expect((within(section).getByRole('switch', { name: '用词表' }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(within(section).getByRole('button', { name: '重新读取网页翻译设置' }));
    await waitFor(() => expect((within(section).getByRole('combobox', { name: '翻译成' }) as HTMLSelectElement).value)
      .toBe('en'));
  });
});
