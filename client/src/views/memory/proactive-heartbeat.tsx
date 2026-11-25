import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import { HEARTBEAT_INTERVALS, type HeartbeatItem, type HeartbeatView } from '../../api/shared.ts';
import { useLive, useTimeZone } from '../../live.tsx';
import { Icon } from '../../shell/icons.tsx';
import { ModelPicker } from '../models/model-picker.tsx';
import { SelectButton, SettingRow, SettingSwitch, type SelectOption } from '../settings/setting-row.tsx';

const HEARTBEAT_ROW_ID = 'heartbeat';

export interface HeartbeatControl {
  view: HeartbeatView | null;
  error: string | null;
  busy: boolean;
  saveItems(items: HeartbeatItem[]): void;
  say(text: string): Promise<boolean>;
  setInterval(minutes: HeartbeatView['config']['intervalMinutes']): void;
  setQuiet(from: string, to: string): void;
  setEnabled(on: boolean): void;
}

export function useHeartbeat(): HeartbeatControl {
  const api = useApi();
  const live = useLive();
  const [view, setView] = useState<HeartbeatView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback((signal?: AbortSignal) => {
    api.tasks.heartbeat(signal).then((next) => {
      if (signal?.aborted !== true) {
        setView(next);
      }
    }, (cause: unknown) => {
      if (signal?.aborted !== true) {
        setError(`心跳没读到：${errorText(cause)}`);
      }
    });
  }, [api]);
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    const stop = live.hub.on((event) => {
      if (event.type === 'tasks.changed') {
        load(controller.signal);
      }
    });
    return () => {
      stop();
      controller.abort();
    };
  }, [live, load]);
  const write = (work: Promise<HeartbeatView>): Promise<boolean> => {
    setBusy(true);
    return work.then((next) => {
      setView(next);
      setError(null);
      return true;
    }, (cause: unknown) => {
      setError(errorText(cause));
      return false;
    }).finally(() => setBusy(false));
  };
  return {
    view,
    error,
    busy,
    saveItems(items) {
      if (view !== null) {
        setView({ ...view, config: { ...view.config, items } });
      }
      void write(api.tasks.updateHeartbeat({ requestId: createRequestId(),
        items: items.map((item) => ({ id: item.id, text: item.text })) }));
    },
    say: (text) => write(api.tasks.sayToHeartbeat({ requestId: createRequestId(), text })),
    setInterval(minutes) {
      void write(api.tasks.updateHeartbeat({ requestId: createRequestId(), intervalMinutes: minutes }));
    },
    setQuiet(from, to) {
      void write(api.tasks.updateHeartbeat({ requestId: createRequestId(), quietFrom: from, quietTo: to }));
    },
    setEnabled(on) {
      void write(api.tasks.setTimedEnabled({ requestId: createRequestId(), rowId: HEARTBEAT_ROW_ID, on })
        .then(() => api.tasks.heartbeat()));
    },
  };
}

function everyLabel(minutes: number): string {
  return minutes % 60 === 0 ? `每 ${minutes / 60} 小时` : `每 ${minutes} 分钟`;
}

function clockText(at: string, timeZone: string): string {
  return new Date(at).toLocaleTimeString('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

function move<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

function Checklist({ items, save }: { items: HeartbeatItem[]; save: (next: HeartbeatItem[]) => void }): ReactNode {
  const dragging = useRef<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const keyMove = (index: number) => (event: KeyboardEvent<HTMLButtonElement>): void => {
    const to = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : null;
    if (to === null || to < 0 || to >= items.length) {
      return;
    }
    event.preventDefault();
    save(move(items, index, to));
  };
  return (
    <ul className="heartbeat-items" aria-label="想听的">
      {items.map((item, index) => (
        <li key={item.id} className="heartbeat-item" draggable data-over={over === index ? '' : undefined}
          onDragStart={(event) => {
            dragging.current = index;
            event.dataTransfer?.setData('text/plain', item.id);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setOver(index);
          }}
          onDragLeave={() => setOver(null)}
          onDrop={(event) => {
            event.preventDefault();
            setOver(null);
            const from = dragging.current;
            dragging.current = null;
            if (from !== null && from !== index) {
              save(move(items, from, index));
            }
          }}
          onDragEnd={() => setOver(null)}>
          <button type="button" className="heartbeat-grip" aria-label={`拖动排序：${item.text}`}
            onKeyDown={keyMove(index)}><Icon name="grip" size={14} /></button>
          <span className="heartbeat-item-text">{item.text}</span>
          <button type="button" className="icon-button heartbeat-remove" aria-label={`删除：${item.text}`}
            onClick={() => save(items.filter((existing) => existing.id !== item.id))}>
            <Icon name="close" size={14} />
          </button>
        </li>
      ))}
    </ul>
  );
}

export function WantList({ heartbeat }: { heartbeat: HeartbeatControl }): ReactNode {
  const [said, setSaid] = useState('');
  const { view, busy } = heartbeat;
  if (view === null) {
    return null;
  }
  const say = (): void => {
    const text = said.trim();
    if (text === '' || busy) {
      return;
    }
    void heartbeat.say(text).then((ok) => {
      if (ok) {
        setSaid('');
      }
    });
  };
  return (
    <>
      <Checklist items={view.config.items} save={heartbeat.saveItems} />
      <label className="heartbeat-say">
        <Icon name="plus" size={14} />
        <input className="heartbeat-say-input" aria-label="加一条，或者说怎么改" value={said} disabled={busy}
          placeholder="加一条，或者说「别再看信息流了」" onChange={(event) => setSaid(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault();
              say();
            }
          }} />
      </label>
    </>
  );
}

const CLOCKS: readonly SelectOption<string>[] = Array.from({ length: 48 }, (_, index) => {
  const clock = `${String(Math.floor(index / 2)).padStart(2, '0')}:${index % 2 === 0 ? '00' : '30'}`;
  return { value: clock, label: clock };
});

function clocksWith(value: string): readonly SelectOption<string>[] {
  return CLOCKS.some((option) => option.value === value) ? CLOCKS
    : [...CLOCKS, { value, label: value }].sort((a, b) => a.value.localeCompare(b.value));
}

export function WhenRows({ heartbeat }: { heartbeat: HeartbeatControl }): ReactNode {
  const { view, busy } = heartbeat;
  if (view === null) {
    return null;
  }
  const { config } = view;
  return (
    <div className="proactive-rows">
      <SettingSwitch name="心跳" checked={view.enabled} disabled={busy}
        tip="每隔一会儿替你看一眼「想听的」那几件事；有要你知道的才发消息。" onChange={heartbeat.setEnabled} />
      <SettingRow name="多久看一次">
        <SelectButton label="多久看一次" value={String(config.intervalMinutes)} disabled={busy}
          options={HEARTBEAT_INTERVALS.map((minutes) => ({ value: String(minutes), label: everyLabel(minutes) }))}
          onChange={(value) => heartbeat.setInterval(Number(value) as HeartbeatView['config']['intervalMinutes'])} />
      </SettingRow>
      <SettingRow name="不打扰">
        <span className="proactive-quiet">
          <SelectButton label="不打扰从几点" value={config.quietFrom} disabled={busy}
            options={clocksWith(config.quietFrom)} onChange={(value) => heartbeat.setQuiet(value, config.quietTo)} />
          <span aria-hidden="true">–</span>
          <SelectButton label="不打扰到几点" value={config.quietTo} disabled={busy}
            options={clocksWith(config.quietTo)} onChange={(value) => heartbeat.setQuiet(config.quietFrom, value)} />
        </span>
      </SettingRow>
      <SettingRow name="模型">
        <span className="heartbeat-model"><ModelPicker purpose="heartbeat" name="心跳的模型" /></span>
      </SettingRow>
    </div>
  );
}

export function RecentBeats({ heartbeat }: { heartbeat: HeartbeatControl }): ReactNode {
  const timeZone = useTimeZone();
  const recent = heartbeat.view?.recent ?? [];
  if (recent.length === 0) {
    return null;
  }
  return (
    <ul className="heartbeat-recent">
      {recent.map((beat) => (
        <li key={beat.at} data-failed={beat.failed ? '' : undefined}>
          <span className="heartbeat-recent-at">{clockText(beat.at, timeZone)}</span>{beat.note}
        </li>
      ))}
    </ul>
  );
}
