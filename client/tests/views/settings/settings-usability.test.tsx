import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../../helpers.tsx';

async function openSettings(section: 'AI' | '通用' = 'AI') {
  fireEvent.click(within(screen.getByRole('navigation', { name: '栏目' })).getByRole('button', { name: /^设置/ }));
  const panel = await screen.findByRole('dialog', { name: '设置' });
  fireEvent.click(within(panel).getByRole('button', { name: section }));
  return panel;
}

describe('Settings user interaction paths', () => {
  it('traps Tab and Shift+Tab focus cycle inside settings modal', async () => {
    await renderApp();
    const panel = await openSettings('通用');
    const first = within(panel).getByRole('searchbox', { name: '搜设置' });
    const close = within(panel).getByRole('button', { name: '关掉设置' });
    await within(panel).findByRole('region', { name: '时区' });
    expect(within(panel).queryByRole('region', { name: '提建议或反馈' })).toBeNull();
    const controls = [...panel.querySelectorAll<HTMLElement>('button, input, select, textarea')]
      .filter((element) => !element.matches(':disabled'));
    const last = controls.at(-1)!;
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
    expect(close).toBeTruthy();
  });

  it('timezone sits after Appearance in General, searches Beijing time, and resets to Follow device', async () => {
    const app = await renderApp();
    const panel = await openSettings('通用');
    const zone = await within(panel).findByRole('region', { name: '时区' });
    const appearance = within(panel).getByRole('heading', { name: '外观' });
    expect(appearance.compareDocumentPosition(zone) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(panel).queryByRole('button', { name: '保存' })).toBeNull();
    fireEvent.click(await within(panel).findByRole('switch', { name: '跟随设备' }));
    const search = within(panel).getByRole('searchbox', { name: '搜索城市或时区' });
    expect(within(panel).queryByRole('list', { name: '可选时区' })).toBeNull();
    fireEvent.change(search, { target: { value: '广州' } });
    fireEvent.click(within(panel).getByRole('button', { name: /北京.*上海.*广州/ }));
    expect(within(panel).queryByRole('list', { name: '可选时区' })).toBeNull();
    expect((search as HTMLInputElement).value).toBe('');
    expect(within(panel).getByLabelText('时区名称')).toHaveProperty('value', 'Asia/Shanghai');
    expect(within(panel).getByLabelText('所选时区的当前时间').textContent).toContain('UTC+08:00');
    fireEvent.click(within(panel).getByRole('button', { name: '保存' }));
    await waitFor(async () => expect((await app.api.today.settings()).timeZone).toBe('Asia/Shanghai'));
    fireEvent.click(within(panel).getByRole('switch', { name: '跟随设备' }));
    fireEvent.click(within(panel).getByRole('button', { name: '保存' }));
    await waitFor(async () => expect((await app.api.today.settings()).timeZone).toBeNull());
  });

});

it('feed card actions are named icon buttons with tooltips; Discuss opens side chat for that item', async () => {
  const app = await renderApp({ hash: '#/feed', setup: ({ control }) => {
    control.feed.seedItem({ id: 'ui-actions', title: '一次明确的操作', summary: '值得讨论的内容' });
  } });
  const row = await screen.findByRole('listitem', { name: '一次明确的操作' });
  expect(row.getAttribute('data-tip')).toBeNull();
  for (const name of ['收藏', '讨论', '不感兴趣']) {
    expect(within(row).getByRole('button', { name }).getAttribute('data-tip')).toBe(name);
  }
  expect(within(row).getByRole('button', { name: '收藏' }).getAttribute('data-tip')).not.toContain('书签');
  fireEvent.click(within(row).getByRole('button', { name: '讨论' }));
  expect(window.location.hash).toBe('#/feed');
  expect(app.state.conversationUi.store.get().quotes[0]?.sourceId).toBe('feed:ui-actions');
});

describe('Settings - Daily removed', () => {
  it('removes Daily section and routes legacy #/settings/daily to General timezone', async () => {
    await renderApp({ hash: '#/settings/daily' });
    const panel = await screen.findByRole('dialog', { name: '设置' });
    const nav = within(panel).getByRole('navigation', { name: '设置分类' });
    expect(within(nav).queryByRole('button', { name: '日常' })).toBeNull();
    expect(within(nav).getByRole('button', { name: '通用' }).getAttribute('aria-current')).toBe('page');
    await within(panel).findByRole('region', { name: '时区' });
    await waitFor(() => expect(document.activeElement?.getAttribute('data-settings-focus')).toBe('time-zone'));
    expect(within(panel).queryByText(/十件事|离开多久|每天回看/)).toBeNull();
  });
});
