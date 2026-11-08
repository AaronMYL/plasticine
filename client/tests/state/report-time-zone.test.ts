// 定时按他设备当前的时区算（《优化清单》第 3 条，11-07 定）：打开时报一次；切回来时时区变了（出差）再报，没变不报。

import { describe, expect, it, vi } from 'vitest';
import { startTimeZoneReport } from '../../src/state/report-time-zone.ts';

describe('设备报时区', () => {
  it('打开时报一次；切回来时变了才再报；停了就不再听', async () => {
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

  it('没报成：记一句，下次切回来再试', async () => {
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
