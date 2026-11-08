// 首次使用流程走完（11-08 设计稿 Phone-Step / First-Main）：第 3 步「在手机上也能用」——二维码指向 <账号>.cyberhunter.top/#/login，
// 「进入 Plasticine」落在主线；没加入网络就跳过第 3 步。主线里 Plasticine 先打招呼，三个开始点了把 prompt 发进主线；
// 有欢迎消息时首页不再出「有什么想一起做的？」。

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FAKE_LOCAL_TOKEN, WELCOME_STARTS } from '../../../src/api/fake/fake-account.ts';
import { startFirstRun, inFirstRun } from '../../../src/views/onboard/first-run.ts';
import { HOME_HEADING, renderApp, setViewportWidth } from '../../helpers.tsx';
import { installDesktop, removeDesktop } from './desktop-bridge.ts';

afterEach(() => {
  removeDesktop();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('在手机上也能用', () => {
  it('起了 @账号：第 3 步二维码指向手机登录页，下面是地址；「进入 Plasticine」落在主线，第一次的流程结束', async () => {
    startFirstRun();
    await renderApp({ hash: '#/plasticine', setup: (fake) => {
      fake.control.network.register('alex', 'Alex');
      fake.control.account.postWelcome();
    } });
    const page = await screen.findByRole('main', { name: '在手机上也能用' });
    expect(within(page).getByRole('img', { name: '第 3 步，共 3 步' })).toBeTruthy();
    expect(within(page).getByRole('img', { name: '二维码：https://alex.cyberhunter.top/#/login' })).toBeTruthy();
    expect(within(page).getByText('alex.cyberhunter.top')).toBeTruthy();
    expect(within(page).getByText('手机扫码，输入密码')).toBeTruthy();
    fireEvent.click(within(page).getByRole('button', { name: '进入 Plasticine' }));
    expect(await screen.findByRole('article', { name: 'Plasticine 的欢迎' })).toBeTruthy();
    expect(window.location.hash).toBe('#/plasticine');
    expect(inFirstRun()).toBe(false);
  });

  it('没加入网络：跳过第 3 步，直接进主线', async () => {
    startFirstRun();
    await renderApp({ hash: '#/today', setup: (fake) => fake.control.account.postWelcome() });
    expect(await screen.findByRole('article', { name: 'Plasticine 的欢迎' })).toBeTruthy();
    expect(screen.queryByRole('main', { name: '在手机上也能用' })).toBeNull();
    expect(window.location.hash).toBe('#/plasticine');
  });

  it('从建账号一路走到主线：建账号 → 连模型（填 key）→ 手机 → 主线打招呼', async () => {
    installDesktop();
    await renderApp({ hash: '#/today', signedIn: false, modelConnected: false,
      setup: (fake) => fake.control.account.seedFresh() });
    await screen.findByRole('main', { name: '建一个账号' });
    fireEvent.change(screen.getByLabelText('叫你什么'), { target: { value: 'Alex' } });
    fireEvent.change(screen.getByLabelText('@账号'), { target: { value: 'alex' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'fake-pass-1234' } });
    await screen.findByText('能用');
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    const connect = await screen.findByRole('main', { name: '连接模型' });
    fireEvent.click(within(within(connect).getByRole('listitem', { name: 'DeepSeek' })).getByRole('button',
      { name: '填 key' }));
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-test-12345678' } });
    fireEvent.click(screen.getByRole('button', { name: '连接' }));
    fireEvent.click(await screen.findByRole('button', { name: '下一步' }));
    fireEvent.click(await screen.findByRole('button', { name: '进入 Plasticine' }));
    const welcome = await screen.findByRole('article', { name: 'Plasticine 的欢迎' });
    expect(welcome.textContent).toContain('你好 Alex');
    expect(FAKE_LOCAL_TOKEN).toBeTruthy();
  });
});

describe('第一次进主线', () => {
  it('Plasticine 头像、名字、一段话和三个开始；点一个把 prompt 发进主线', async () => {
    const app = await renderApp({ hash: '#/plasticine', setup: (fake) => {
      fake.control.account.seedName('Alex');
      fake.control.account.postWelcome();
    } });
    const welcome = await screen.findByRole('article', { name: 'Plasticine 的欢迎' });
    expect(within(welcome).getByText('Plasticine')).toBeTruthy();
    expect(welcome.textContent).toContain('以你名义对外、花钱、删东西之前，都会先问你');
    const starts = within(welcome).getByRole('group', { name: '从哪儿开始' });
    expect(within(starts).getAllByRole('button').map((button) => button.textContent))
      .toEqual(WELCOME_STARTS.map((start) => start.label));
    const send = vi.spyOn(app.api.lines, 'send');
    fireEvent.click(within(starts).getByRole('button', { name: '订几个信息源' }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0]?.[1].text).toBe(WELCOME_STARTS[1]?.prompt);
  });

  it('手机上一样有欢迎和开始', async () => {
    setViewportWidth(390);
    await renderApp({ width: 390, hash: '#/plasticine', setup: (fake) => fake.control.account.postWelcome() });
    const welcome = await screen.findByRole('article', { name: 'Plasticine 的欢迎' });
    expect(within(welcome).getAllByRole('button')).toHaveLength(3);
  });

  it('主线里有欢迎消息时，首页不再出「有什么想一起做的？」', async () => {
    await renderApp({ hash: '#/today', setup: (fake) => fake.control.account.postWelcome() });
    await screen.findByRole('heading', { name: HOME_HEADING });
    await waitFor(() => expect(screen.queryByRole('region', { name: '开始一件事' })).toBeNull());
  });

  it('没有欢迎消息的空实例照旧有首页的开始输入框', async () => {
    await renderApp({ hash: '#/today' });
    expect(await screen.findByRole('region', { name: '开始一件事' })).toBeTruthy();
  });
});
