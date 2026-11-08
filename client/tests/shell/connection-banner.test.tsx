// 连接横幅（用户视角审查 2026-11-01 第 4 条）：事件流断开超过几秒，主区顶部出一条「未连接 · 正在重连」，手机上也有
// （手机没有侧栏脚的连接点）；连上后自动消失；短暂重连不打扰。

import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONNECTION_BANNER_AFTER_MS } from '../../src/shell/connection-banner.tsx';
import { renderApp, settle } from '../helpers.tsx';

afterEach(() => {
  vi.useRealTimers();
});

describe('连接横幅', () => {
  for (const width of [1440, 390]) {
    it(`${width} 宽：断开超过 ${CONNECTION_BANNER_AFTER_MS}ms 才出横幅，重连上就收`, async () => {
      const app = await renderApp({ width });
      await settle();
      expect(screen.queryByText(/未连接 · 正在重连/)).toBeNull();
      vi.useFakeTimers();
      act(() => {
        app.control.bus.offline = true;
        app.control.bus.disconnectAll();
      });
      await act(() => vi.advanceTimersByTimeAsync(CONNECTION_BANNER_AFTER_MS - 100));
      expect(screen.queryByText(/未连接 · 正在重连/)).toBeNull();
      await act(() => vi.advanceTimersByTimeAsync(200));
      expect(screen.getByText(/未连接 · 正在重连/)).toBeTruthy();
      app.control.bus.offline = false;
      // 退避 1、2、4 秒：第三次重连成功，横幅收起。
      await act(() => vi.advanceTimersByTimeAsync(8000));
      expect(screen.queryByText(/未连接 · 正在重连/)).toBeNull();
    });
  }

  it('一两秒内接回去的断线不出横幅', async () => {
    const app = await renderApp();
    await settle();
    vi.useFakeTimers();
    act(() => {
      app.control.bus.disconnectAll();
    });
    await act(() => vi.advanceTimersByTimeAsync(CONNECTION_BANNER_AFTER_MS + 500));
    expect(screen.queryByText(/未连接 · 正在重连/)).toBeNull();
  });
});
