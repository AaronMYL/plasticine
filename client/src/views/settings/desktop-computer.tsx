import { useState, type ReactNode } from 'react';
import type { DeviceServiceStatus, UpdateStatus } from '../../api/shared.ts';
import { useApi } from '../../api/context.tsx';
import { useLive } from '../../live.tsx';
import { runDesktopUpdate, updateFraction } from '../../shell/desktop-update.ts';
import { InfoTip } from '../../shell/info-tip.tsx';
import { useClientState } from '../../state/context.tsx';
import { parseDevice, parseUpdate, type DesktopShell, type DesktopState } from './desktop-shell.ts';
import { SectionHead } from './section-head.tsx';
import { SettingRow } from './setting-row.tsx';
import './desktop.css';

const DEVICE_SCOPE = '文件、命令、截屏和点按、日历、提醒事项';
const PERMISSION_NAMES = { screen: '截屏', accessibility: '点按和输入' } as const;
const WORKING_LABELS: Readonly<Partial<Record<UpdateStatus['state'], string>>> = { checking: '在查…',
  downloading: '在下载…', installing: '在换…' };

function UpdateRow({ shell, update, onUpdate }: { shell: DesktopShell; update: UpdateStatus | null;
  onUpdate: (update: UpdateStatus) => void }): ReactNode {
  const [error, setError] = useState<string | null>(null);
  const api = useApi();
  const clientState = useClientState();
  const state = update?.state ?? 'idle';
  const install = (): void => {
    if (update === null) return;
    setError(null);
    runDesktopUpdate(shell, api, clientState, update).then((outcome) => {
      if (outcome.kind === 'blocked') setError(`先处理：${outcome.reasons.join('、')}`);
    }, (cause: unknown) => setError(cause instanceof Error ? cause.message : '没更新成，稍后再试。'));
  };
  const check = (): void => {
    setError(null);
    shell.updates.check().then((value) => onUpdate(parseUpdate(value)),
      (cause: unknown) => setError(cause instanceof Error ? cause.message : '没查成，稍后再试。'));
  };
  const problem = error ?? (state === 'failed' ? update?.problem ?? null : null);
  let action: ReactNode;
  if (state === 'ready') {
    action = <button type="button" className="primary-button" onClick={install}>重新打开</button>;
  } else if (state === 'available' || (state === 'failed' && update?.available != null)) {
    action = <button type="button" className="primary-button" onClick={install}>
      {state === 'failed' ? '重新下载' : '下载并更新'}</button>;
  } else if (state === 'downloading' && update !== null) {
    action = <button type="button" className="secondary-button" disabled>
      在下载 {Math.round(updateFraction(update) * 100)}%</button>;
  } else {
    const working = state === 'checking' || state === 'downloading' || state === 'installing';
    action = <button type="button" className="secondary-button" disabled={working} onClick={check}>
      {WORKING_LABELS[state] ?? '检查更新'}</button>;
  }
  const sub = state === 'ready' && update?.available != null
    ? <>新版本 <span className="mono">{update.available}</span> 已下好</>
    : (state === 'available' || state === 'downloading') && update?.available != null
      ? <>有新版本 <span className="mono">{update.available}</span></>
      : <span className="mono">Plasticine {shell.version}</span>;
  return (
    <SettingRow name="客户端" sub={sub}>
      {problem === null ? null : <InfoTip label="更新没成的原因" text={problem} />}
      {action}
    </SettingRow>
  );
}

function deviceMeta(device: DeviceServiceStatus | null): string {
  switch (device?.state) {
    case 'paused':
      return '暂停了';
    case 'repair':
      return '要重新配对';
    case 'offline':
      return '连不上本体';
    default:
      return DEVICE_SCOPE;
  }
}

function DeviceRow({ shell, device, onDevice }: { shell: DesktopShell; device: DeviceServiceStatus | null;
  onDevice: (device: DeviceServiceStatus) => void }): ReactNode {
  const live = useLive();
  const { deviceUi } = useClientState();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const on = device !== null && device.state !== 'paused' && device.state !== 'unpaired' && device.state !== 'repair';
  const fail = (cause: unknown): void => setError(cause instanceof Error ? cause.message : '没成，稍后再试。');
  const pair = async (): Promise<void> => {
    await live.deviceWrites.issueCode();
    const code = deviceUi.store.get().code;
    if (code === null) {
      throw new Error('没领到配对码，稍后再试。');
    }
    onDevice(parseDevice(await shell.device.pair({ code: code.code })));
    deviceUi.showCode(null);
  };
  const toggle = (): void => {
    setError(null);
    setBusy(true);
    const unpaired = device === null || device.state === 'unpaired' || device.state === 'repair';
    const work = on ? shell.device.pause(true).then((value) => onDevice(parseDevice(value)))
      : unpaired ? pair() : shell.device.pause(false).then((value) => onDevice(parseDevice(value)));
    work.catch(fail).finally(() => setBusy(false));
  };
  const missing = (device?.missing ?? []).filter((name): name is keyof typeof PERMISSION_NAMES =>
    name === 'screen' || name === 'accessibility');
  return (
    <>
      <SettingRow name="让 Plasticine 用这台电脑" sub={deviceMeta(device)}>
        <input type="checkbox" role="switch" aria-label="让 Plasticine 用这台电脑" checked={on}
          disabled={busy || device === null} onChange={toggle} />
      </SettingRow>
      {on && missing.length > 0 ? <div className="set-sub">
        <SettingRow name={<span className="set-row-error">
          {missing.map((name) => PERMISSION_NAMES[name]).join('、')}没授权</span>}>
          {missing.map((name) => <button key={name} type="button" className="secondary-button"
            onClick={() => shell.device.openPermission(name)}>去授权{missing.length > 1 ? PERMISSION_NAMES[name] : ''}
          </button>)}
        </SettingRow>
      </div> : null}
      {error === null ? null : <p className="block-empty is-error" role="alert">{error}</p>}
      {device?.problem == null || !on ? null : <p className="block-empty" role="status">{device.problem}</p>}
    </>
  );
}

export function DesktopComputer({ shell, state, onChange }: { shell: DesktopShell; state: DesktopState;
  onChange: (change: Partial<DesktopState>) => void }): ReactNode {
  const [error, setError] = useState<string | null>(null);
  const toggleNotifications = (): void => {
    const next = state.notifications !== true;
    setError(null);
    shell.notifications.setEnabled(next).then((value) => onChange({ notifications: value === true }),
      (cause: unknown) => setError(cause instanceof Error ? cause.message : '没改成，稍后再试。'));
  };
  return (
    <section className="block" aria-labelledby="settings-desktop-computer">
      <SectionHead id="settings-desktop-computer" title="这台电脑" />
      <UpdateRow shell={shell} update={state.update} onUpdate={(update) => onChange({ update })} />
      <SettingRow name="系统通知">
        <input type="checkbox" role="switch" aria-label="系统通知" checked={state.notifications === true}
          disabled={state.notifications === null} onChange={toggleNotifications} />
      </SettingRow>
      <DeviceRow shell={shell} device={state.device} onDevice={(device) => onChange({ device })} />
      {error === null ? null : <p className="block-empty is-error" role="alert">{error}</p>}
    </section>
  );
}
