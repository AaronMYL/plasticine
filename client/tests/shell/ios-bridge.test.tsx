import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { isPlasticineIOS } from '../../src/ios/bridge.ts';
import { renderApp } from '../helpers.tsx';

afterEach(() => {
  delete window.plasticineIOS;
  vi.restoreAllMocks();
});

it('iPhone App 标识支持注入对象和 User-Agent，普通浏览器不会误认', () => {
  expect(isPlasticineIOS()).toBe(false);
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone) PlasticineIOS/0.1.0');
  expect(isPlasticineIOS()).toBe(true);
});

it('在 iPhone App 里，设置的「装到主屏幕」换成原生页面入口，点了交给 App 打开', async () => {
  const open = vi.fn();
  window.plasticineIOS = { version: '0.1.0', open };
  await renderApp({ hash: '#/today', width: 1440 });
  fireEvent.click(within(screen.getByRole('navigation', { name: '栏目' })).getByRole('button', { name: /^设置/ }));
  expect(await screen.findByText('iPhone App')).toBeDefined();
  expect(screen.queryByText('装到主屏幕')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '设置与自检' }));
  fireEvent.click(screen.getByRole('button', { name: '拍照交给 Plasticine' }));
  fireEvent.click(screen.getByRole('button', { name: '说给 Plasticine' }));
  expect(open.mock.calls).toEqual([['settings'], ['photo'], ['voice']]);
});
