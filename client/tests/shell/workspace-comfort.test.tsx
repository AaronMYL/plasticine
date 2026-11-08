import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MainErrorBoundary } from '../../src/shell/main-error-boundary.tsx';
import { AppearanceSection } from '../../src/views/settings/appearance-section.tsx';
import { renderApp, settle } from '../helpers.tsx';

afterEach(() => { localStorage.removeItem('plasticine.appearance'); delete document.documentElement.dataset.theme; });

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
  fireEvent.click(screen.getByRole('button', { name: '再试一次' }));
  expect(screen.getByText('页面恢复')).toBeTruthy();
  log.mockRestore();
});

it('外观在本设备记住，跟随系统取消固定主题', () => {
  const view = render(<AppearanceSection />);
  fireEvent.change(screen.getByLabelText('外观'), { target: { value: 'dark' } });
  expect(document.documentElement.dataset.theme).toBe('dark');
  view.unmount();
  render(<AppearanceSection />);
  expect(screen.getByLabelText('外观')).toHaveProperty('value', 'dark');
  fireEvent.change(screen.getByLabelText('外观'), { target: { value: 'system' } });
  expect(document.documentElement.dataset.theme).toBeUndefined();
});

it('页里点链接走一步：⌘[ 后退回到原页和阅读位置', async () => {
  await renderApp({ hash: '#/memory', setup: (fake) => fake.control.memoryTopics.seed() });
  const main = screen.getByRole('main');
  main.scrollTop = 240;
  fireEvent.scroll(main);
  fireEvent.click(await within(main).findByRole('button', { name: /^怎么替你做事/ }));
  await waitFor(() => expect(window.location.hash).toBe('#/memory/topics/memdoc-rules'));
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
