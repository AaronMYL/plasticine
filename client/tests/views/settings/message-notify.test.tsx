// 新消息通知（第13批）：桌面客户端收到服务端的 notify 事件自己弹；他正在窗口里看着那段就不弹；同一条只弹一次。
// 页面在前台、窗口有焦点时把开着的那段对话报给服务端，切走报 null。

import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeApi } from '../../../src/api/fake/index.ts';
import { FakePushDevice } from '../../../src/api/fake/fake-push-device.ts';
import { PushSwitch } from '../../../src/views/settings/push-switch.ts';
import { startPresenceReport, useViewing } from '../../../src/state/viewing.ts';
import { NOW } from '../../helpers.tsx';

function Viewing({ conversation }: { conversation: string | null }): null {
  useViewing(conversation);
  return null;
}

const event = { type: 'notify' as const, title: '林一', body: '周末一起去看展吗？', url: '/#/messages/c1/at/m1',
  tag: 'contact-c1', conversation: 'contact:c1' };

afterEach(() => {
  delete (window as { plasticineDesktop?: unknown }).plasticineDesktop;
  vi.restoreAllMocks();
});

describe('新消息通知', () => {
  it('桌面客户端：没在看那段就弹，点开去那一句；同一条只弹一次；正看着那段不弹', () => {
    const notify = vi.fn();
    (window as { plasticineDesktop?: unknown }).plasticineDesktop = { notify };
    const fake = createFakeApi({ seed: false, streamStepMs: 0, now: () => NOW });
    const toggle = new PushSwitch(fake.api, new FakePushDevice({ answer: 'granted' }));
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    toggle.onEvent(event);
    toggle.onEvent(event);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('林一', '周末一起去看展吗？', '#/messages/c1/at/m1');
    const view = render(<Viewing conversation="contact:c1" />);
    toggle.onEvent({ ...event, url: '/#/messages/c1/at/m2' });
    expect(notify).toHaveBeenCalledTimes(1);
    view.unmount();
    toggle.onEvent({ ...event, url: '/#/messages/c1/at/m3' });
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('网页里不弹（网页推送由服务端发）', () => {
    const fake = createFakeApi({ seed: false, streamStepMs: 0, now: () => NOW });
    const toggle = new PushSwitch(fake.api, new FakePushDevice({ answer: 'granted' }));
    expect(() => toggle.onEvent(event)).not.toThrow();
  });

  it('报正在看哪段：开着、有焦点时报那段；关上、失焦报 null', () => {
    const reported: (string | null)[] = [];
    const focused = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const stop = startPresenceReport(async (conversation) => {
      reported.push(conversation);
    });
    const view = render(<Viewing conversation="line:line-main" />);
    focused.mockReturnValue(false);
    window.dispatchEvent(new Event('blur'));
    focused.mockReturnValue(true);
    window.dispatchEvent(new Event('focus'));
    view.unmount();
    stop();
    expect(reported).toEqual([null, 'line:line-main', null, 'line:line-main', null]);
  });
});
