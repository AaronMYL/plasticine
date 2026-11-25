import { useEffect, useState, type ReactNode } from 'react';
import type { NodeView } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { desktopHelper } from '../../mac/desktop-helper.ts';
import { InfoTip } from '../../shell/info-tip.tsx';
import { useStore } from '../../state/use-store.ts';
import { SectionHead } from './section-head.tsx';
import { SettingRow } from './setting-row.tsx';

export function calendarNode(nodes: readonly NodeView[]): NodeView | null {
  const macs = nodes.filter((node) => node.platform === 'macos' && node.revokedAt === null);
  macs.sort((left, right) => Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt));
  return macs[0] ?? null;
}

type Granted = { calendar: boolean; reminders: boolean };

function statusText(granted: Granted): string {
  if (granted.calendar && granted.reminders) {
    return '已授权';
  }
  if (granted.calendar) {
    return '提醒事项没授权';
  }
  return granted.reminders ? '日历没授权' : '没授权';
}

export function CalendarAccess(): ReactNode {
  const live = useLive();
  const nodes = useStore(live.devices.nodes);
  useEffect(() => live.devices.open(), [live.devices]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const mac = calendarNode(nodes.value?.nodes ?? []);
  const bridge = desktopHelper();
  const granted = { calendar: mac?.capabilities.includes('calendar_list') ?? false,
    reminders: mac?.capabilities.includes('reminder_list') ?? false };
  const authorize = (): void => {
    if (bridge === null) {
      return;
    }
    setBusy(true);
    setNote(null);
    const kinds = (['calendar', 'reminders'] as const).filter((kind) => !granted[kind]);
    void kinds.reduce<Promise<boolean>>((done, kind) => done.then(async (allGranted) => {
      const result = await bridge.call('permissions.request', { kind });
      return allGranted && result.granted;
    }), Promise.resolve(true)).then((allGranted) => {
      setNote(allGranted ? null : '到「系统设置 → 隐私与安全性」里打开 Plasticine');
    }, (cause: unknown) => {
      setNote(cause instanceof Error ? cause.message : '没能弹出授权，稍后再试');
    }).finally(() => setBusy(false));
  };
  return (
    <section className="block" aria-labelledby="settings-calendar-access">
      <SectionHead id="settings-calendar-access" title="日历和提醒事项" />
      <SettingRow name={mac === null ? '还没连 Mac' : mac.name} sub={mac === null ? undefined : statusText(granted)}>
        {mac === null || granted.calendar && granted.reminders ? null : bridge === null
          ? <InfoTip label="「日历和提醒事项」怎么授权" text="在那台 Mac 上打开 Plasticine，到这里点「去授权」。" />
          : <button type="button" className="secondary-button" disabled={busy} onClick={authorize}>
            去授权</button>}
      </SettingRow>
      {note === null ? null : <p className="block-empty" role="status">{note}</p>}
    </section>
  );
}
