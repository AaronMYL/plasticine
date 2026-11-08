import { useEffect } from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ApiProvider } from '../../../src/api/context.tsx';
import { PushDeviceContext } from '../../../src/api/push-device.ts';
import { LiveProvider, useLive, useTimeZone } from '../../../src/live.tsx';
import { ClientStateProvider } from '../../../src/state/context.tsx';
import { Telemetry, TelemetryContext, memorySink } from '../../../src/telemetry.ts';
import { DailySettingsSection } from '../../../src/views/settings/daily-settings-section.tsx';
import { renderApp, type AppHarness } from '../../helpers.tsx';

const deviceZone = 'Pacific/Honolulu';
const telemetry = new Telemetry(memorySink([]), false);

function Probe() {
  const live = useLive();
  const timeZone = useTimeZone();
  useEffect(() => {
    live.feed.open();
    live.m5b.money.open();
  }, [live]);
  return <><output aria-label="当前时区">{timeZone}</output><DailySettingsSection /></>;
}

function probe(app: AppHarness) {
  return <ApiProvider api={app.api}><ClientStateProvider state={app.state}>
    <TelemetryContext.Provider value={telemetry}><PushDeviceContext.Provider value={app.pushDevice}>
      <LiveProvider><Probe /></LiveProvider>
    </PushDeviceContext.Provider></TelemetryContext.Provider>
  </ClientStateProvider></ApiProvider>;
}

function mockDeviceZone() {
  const original = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) {
    return { ...original.call(this), timeZone: deviceZone };
  });
}

async function mount(timeZone?: string) {
  mockDeviceZone();
  const app = await renderApp({ setup: ({ api }) => {
    vi.spyOn(api.today, 'settings').mockResolvedValue({ briefLimit: 20, returnThresholdHours: 4,
      interviewEnabled: false, interviewPerDay: 3, version: 0, ...(timeZone === undefined ? {} : { timeZone }) });
    vi.spyOn(api.feed, 'list');
    vi.spyOn(api.money, 'month');
  } });
  app.view.rerender(probe(app));
  return app;
}

async function allUse(app: AppHarness, zone: string) {
  await waitFor(() => {
    expect(screen.getByLabelText('当前时区').textContent).toBe(zone);
    expect(app.api.feed.list).toHaveBeenLastCalledWith(expect.objectContaining({ tz: zone }));
    expect(app.api.money.month).toHaveBeenLastCalledWith(expect.objectContaining({ tz: zone }));
  });
}

it('没有设置时，信息流和记账统一使用设备时区', async () => {
  await allUse(await mount(), deviceZone);
});

it('已保存的时区优先；修改后各页刷新；清空恢复设备时区', async () => {
  const app = await mount('America/Los_Angeles');
  await allUse(app, 'America/Los_Angeles');
  fireEvent.change(screen.getByLabelText('时区名称'), { target: { value: 'Asia/Tokyo' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await allUse(app, 'Asia/Tokyo');
  fireEvent.change(screen.getByLabelText('时区名称'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await allUse(app, deviceZone);
});
