import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { memoryStorage, renderApp } from '../../helpers.tsx';

async function openSettings(section: 'AI' | '通用' = 'AI') {
  fireEvent.click(within(screen.getByRole('navigation', { name: '栏目' })).getByRole('button', { name: /^设置/ }));
  const panel = await screen.findByRole('dialog', { name: '设置' });
  fireEvent.click(within(panel).getByRole('button', { name: section }));
  return panel;
}

describe('设置的用户操作路径', () => {
  it('Tab 只在弹框里转：最后一个往后回到第一个，Shift Tab 从第一个回到最后一个', async () => {
    await renderApp();
    const panel = await openSettings('通用');
    const first = within(panel).getByRole('button', { name: '通用' });
    const close = within(panel).getByRole('button', { name: '关掉设置' });
    await within(panel).findByRole('region', { name: '提建议或反馈' });
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

  it('时区在通用里、外观后面；中文城市搜索可以选择北京时间，跟随设备也可直接切回', async () => {
    const app = await renderApp();
    const panel = await openSettings('通用');
    const zone = await within(panel).findByRole('region', { name: '时区' });
    const appearance = within(panel).getByRole('heading', { name: '外观' });
    expect(appearance.compareDocumentPosition(zone) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(panel).queryByRole('button', { name: '保存' })).toBeNull();
    fireEvent.click(await within(panel).findByRole('button', { name: '选择时区' }));
    const search = within(panel).getByRole('searchbox', { name: '搜索城市或时区' });
    fireEvent.change(search, { target: { value: '广州' } });
    fireEvent.click(within(panel).getByRole('button', { name: /北京.*上海.*广州/ }));
    expect(within(panel).getByLabelText('时区名称')).toHaveProperty('value', 'Asia/Shanghai');
    expect(within(panel).getByLabelText('所选时区的当前时间').textContent).toContain('UTC+08:00');
    fireEvent.click(within(panel).getByRole('button', { name: '保存' }));
    await waitFor(async () => expect((await app.api.today.settings()).timeZone).toBe('Asia/Shanghai'));
    fireEvent.click(within(panel).getByRole('button', { name: '跟随设备' }));
    fireEvent.click(within(panel).getByRole('button', { name: '保存' }));
    await waitFor(async () => expect((await app.api.today.settings()).timeZone).toBeNull());
  });

});

it('信息流卡片的操作是有名字的图标按钮，tooltip 就是名字；「讨论」开一条围绕这一条的旁聊', async () => {
  const app = await renderApp({ hash: '#/feed', setup: ({ control }) => {
    control.feed.seedItem({ id: 'ui-actions', title: '一次明确的操作', summary: '值得讨论的内容' });
  } });
  const row = await screen.findByRole('listitem', { name: '一次明确的操作' });
  // 第 3 批（11-04）：整张卡不挂浮框；卡底四个图标按钮，名字就是 tooltip，收藏归信息流、不进书签。
  expect(row.getAttribute('data-tip')).toBeNull();
  for (const name of ['收藏', '讨论', '不感兴趣']) {
    expect(within(row).getByRole('button', { name }).getAttribute('data-tip')).toBe(name);
  }
  expect(within(row).getByRole('button', { name: '收藏' }).getAttribute('data-tip')).not.toContain('书签');
  fireEvent.click(within(row).getByRole('button', { name: '讨论' }));
  expect(window.location.hash).toBe('#/feed');
  expect(app.state.conversationUi.store.get().quotes[0]?.sourceId).toBe('feed:ui-actions');
});

// 2026-11-08 第 7 批：「日常」那一栏删了（十件事、离开多久算回来、每天回看 11-06 起没有代码在读）；旧链接落到通用的时区。
describe('设置 · 日常删了', () => {
  it('分段里没有「日常」，没有那三项；旧地址 #/settings/daily 打开通用、定位到时区', async () => {
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
