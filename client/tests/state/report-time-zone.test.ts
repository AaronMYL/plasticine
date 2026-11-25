import { describe, expect, it, vi } from 'vitest';
import { startTimeZoneReport } from '../../src/state/report-time-zone.ts';

describe('device timezone reporting', () => {
  it('reports on startup, re-reports on foreground only if changed, stops listening on stop', async () => {
    let zone = 'Asia/Shanghai';
    const reportTimeZone = vi.fn(async (body: { timeZone: string }) => ({ timeZone: body.timeZone }));
    const stop = startTimeZoneReport({ reportTimeZone }, () => zone);
    expect(reportTimeZone).toHaveBeenCalledWith({ timeZone: 'Asia/Shanghai' });
    window.dispatchEvent(new Event('focus'));
    expect(reportTimeZone).toHaveBeenCalledTimes(1);
    zone = 'Asia/Tokyo';
    window.dispatchEvent(new Event('focus'));
    expect(reportTimeZone).toHaveBeenLastCalledWith({ timeZone: 'Asia/Tokyo' });
    expect(reportTimeZone).toHaveBeenCalledTimes(2);
    stop();
    zone = 'Europe/Paris';
    window.dispatchEvent(new Event('focus'));
    expect(reportTimeZone).toHaveBeenCalledTimes(2);
  });

  it('logs failed report and retries on next foreground return', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const reportTimeZone = vi.fn().mockRejectedValueOnce(new Error('连不上'))
      .mockResolvedValue({ timeZone: 'Asia/Shanghai' });
    startTimeZoneReport({ reportTimeZone }, () => 'Asia/Shanghai');
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    window.dispatchEvent(new Event('focus'));
    expect(reportTimeZone).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
