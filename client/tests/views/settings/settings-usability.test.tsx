import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { memoryStorage, renderApp } from '../../helpers.tsx';

async function openSettings(section: 'AI' | '日常' | '通用' = 'AI') {
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

  it('中文城市搜索可以选择北京时间，跟随设备也可直接切回', async () => {
    const app = await renderApp();
    const panel = await openSettings('日常');
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
  await waitFor(() => expect(window.location.hash).toMatch(/^#\/plasticine\/side\//));
  const sides = (await app.api.lines.list({ kind: 'side' })).lines;
  expect(sides[0]?.topic?.ref).toBe('ui-actions');
});

// 用户视角审查 2026-11-01 P2：日常里的勾要说明打开后每天会发生什么（含义取自 agent 里对应功能的实现）。
// 11-04 重做悬停：说明不常显，在开关名字后的 ⓘ 里；开关本身读屏经 aria-describedby 念到。
// 11-04「每天一项现实碰撞」随判断页撤掉（改动方案第 3 批），只剩回看一个勾。
describe('设置 · 日常的说明', () => {
  it('「每天回看项目、工作和反例线索」的说明在名字后的 ⓘ 里，读屏念得到', async () => {
    await renderApp();
    const panel = await openSettings('日常');
    const review = await within(panel).findByRole('switch', { name: '每天回看项目、工作和反例线索' });
    const row = review.closest('.settings-switch-row') as HTMLElement;
    expect(within(row).getByRole('button', { name: /的说明$/ }).getAttribute('data-tip')).toContain('反例');
    const described = document.getElementById(review.getAttribute('aria-describedby') ?? '');
    expect(described?.textContent).toContain('反例');
    expect(described?.classList.contains('sr-only')).toBe(true);
  });
});
