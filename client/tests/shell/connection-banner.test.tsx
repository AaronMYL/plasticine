import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONNECTION_BANNER_AFTER_MS } from '../../src/shell/connection-banner.tsx';
import { renderApp, settle } from '../helpers.tsx';

afterEach(() => {
  vi.useRealTimers();
});

describe('connection banner', () => {
  for (const width of [1440, 390]) {
    it(`${width}px: shows banner after ${CONNECTION_BANNER_AFTER_MS}ms offline, hides on reconnect`, async () => {
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
      await act(() => vi.advanceTimersByTimeAsync(8000));
      expect(screen.queryByText(/未连接 · 正在重连/)).toBeNull();
    });
  }

  it('brief 1-2s disconnect does not show connection banner', async () => {
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
