import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MainErrorBoundary } from '../../src/shell/main-error-boundary.tsx';
import { AppearanceSection } from '../../src/views/settings/appearance-section.tsx';
import { renderApp, settle } from '../helpers.tsx';

afterEach(() => {
  localStorage.removeItem('plasticine.appearance');
  localStorage.removeItem('plasticine.palette');
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.palette;
});

it('页面崩溃只显示该区错误，重试可以恢复，外部对话仍可输入', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  let broken = true;
  function Page() { if (broken) { throw new Error('资料列表无法读取'); } return <p>页面恢复</p>; }
  render(<><input aria-label="仍能对话" /><MainErrorBoundary onHome={() => undefined}><Page /></MainErrorBoundary></>);
  expect(screen.getByText('这一页出错了')).toBeTruthy();
  expect(screen.getByText('资料列表无法读取')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('仍能对话'), { target: { value: '继续问' } });
  expect(screen.getByLabelText('仍能对话')).toHaveProperty('value', '继续问');
  broken = false;
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  expect(screen.getByText('页面恢复')).toBeTruthy();
  log.mockRestore();
});

it('外观在本设备记住，跟随系统取消固定主题', () => {
  // 11-14 设置页一种行：「浅色 / 深色」是一行下拉。
  const pick = (name: string): void => {
    fireEvent.click(screen.getByRole('button', { name: '浅色 / 深色' }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name }));
  };
  const view = render(<AppearanceSection />);
  pick('深色');
  expect(document.documentElement.dataset.theme).toBe('dark');
  view.unmount();
  render(<AppearanceSection />);
  expect(screen.getByRole('button', { name: '浅色 / 深色' }).textContent).toBe('深色');
  pick('跟随系统');
  expect(document.documentElement.dataset.theme).toBeUndefined();
});

it('主题是例外：四张小样（左浅右深、中间一点强调色），点一张马上换，选中那张按下、带勾（11-15 Aaron 弹框定）', () => {
  const view = render(<AppearanceSection />);
  const themes = screen.getByRole('group', { name: '主题' });
  const cards = within(themes).getAllByRole('button');
  expect(cards.map((card) => card.textContent)).toEqual(['暖纸', '石墨', '松林', '午夜']);
  expect(cards[0]?.getAttribute('aria-pressed')).toBe('true');
  expect(screen.queryByRole('button', { name: '主题' })).toBeNull();
  fireEvent.click(within(themes).getByRole('button', { name: '松林' }));
  expect(document.documentElement.dataset.palette).toBe('pine');
  expect(within(themes).getByRole('button', { name: '松林' }).getAttribute('aria-pressed')).toBe('true');
  expect(within(themes).getByRole('button', { name: '暖纸' }).getAttribute('aria-pressed')).toBe('false');
  view.unmount();
  render(<AppearanceSection />);
  expect(within(screen.getByRole('group', { name: '主题' })).getByRole('button', { name: '松林' })
    .getAttribute('aria-pressed')).toBe('true');
});

it('页里点链接走一步：⌘[ 后退回到原页和阅读位置', async () => {
  await renderApp({ hash: '#/memory', setup: (fake) => fake.control.memoryTopics.seed() });
  const main = screen.getByRole('main');
  main.scrollTop = 240;
  fireEvent.scroll(main);
  // 第13批：「规则」那一份不在目录里了，点「关于你」。
  fireEvent.click(await within(main).findByRole('button', { name: /^关于你/ }));
  await waitFor(() => expect(window.location.hash).toBe('#/memory/topics/t_you'));
  fireEvent.keyDown(window, { key: '[', metaKey: true });
  await waitFor(() => expect(window.location.hash).toBe('#/memory'));
  expect(screen.getByRole('main').scrollTop).toBe(240);
});

it('手机下滑收起导航，上滑或停止后恢复', async () => {
  await renderApp({ width: 390 });
  const main = screen.getByRole('main');
  main.scrollTop = 200;
  fireEvent.scroll(main);
  expect(document.querySelector('.phone-bar')?.getAttribute('data-hidden')).toBe('true');
  main.scrollTop = 160;
  fireEvent.scroll(main);
  expect(document.querySelector('.phone-bar')?.getAttribute('data-hidden')).toBe('false');
  main.scrollTop = 250;
  fireEvent.scroll(main);
  await waitFor(() => expect(document.querySelector('.phone-bar')?.getAttribute('data-hidden')).toBe('false'));
});
