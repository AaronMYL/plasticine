// 心跳的弹层（《优化清单》第 11 条，设计稿 Tasks-Heartbeat）：多久一次（安静时段写在旁边）、模型（用途 heartbeat）、
// 看什么（能拖、能删、能用一句话改：「别再看信息流了」）、最近几次。改了马上存；没存上的就地写一句原因。
// 开关在浮层的标题行（timed-sheet.tsx 管）。

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import { HEARTBEAT_INTERVALS, type HeartbeatItem, type HeartbeatView } from '../../api/shared.ts';
import { useLive, useTimeZone } from '../../live.tsx';
import { Icon } from '../../shell/icons.tsx';
import { ModelPicker } from '../models/model-picker.tsx';
import { registerTimedSheet, type TimedSheetProps } from './timed-sheet.tsx';

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

function Field({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return <div className="tasks-field"><span className="tasks-field-label">{label}</span><div>{children}</div></div>;
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
    <ul className="heartbeat-items" aria-label="看什么">
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
          <button type="button" className="icon-button heartbeat-remove" aria-label={`删掉：${item.text}`}
            onClick={() => save(items.filter((existing) => existing.id !== item.id))}>
            <Icon name="close" size={14} />
          </button>
        </li>
      ))}
    </ul>
  );
}

export function HeartbeatSheet({ row }: TimedSheetProps): ReactNode {
  const api = useApi();
  const live = useLive();
  const timeZone = useTimeZone();
  const [view, setView] = useState<HeartbeatView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState('');
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
  }, [live, load, row.enabled]);
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
  if (view === null) {
    return error === null ? null : <p className="tasks-error" role="alert">{error}</p>;
  }
  const { config } = view;
  const saveItems = (items: HeartbeatItem[]): void => {
    setView({ ...view, config: { ...config, items } });
    void write(api.tasks.updateHeartbeat({ requestId: createRequestId(),
      items: items.map((item) => ({ id: item.id, text: item.text })) }));
  };
  const say = (): void => {
    const text = said.trim();
    if (text === '' || busy) {
      return;
    }
    void write(api.tasks.sayToHeartbeat({ requestId: createRequestId(), text })).then((ok) => {
      if (ok) {
        setSaid('');
      }
    });
  };
  return (
    <div className="tasks-sheet-body heartbeat-sheet">
      <Field label="多久一次">
        <span className="heartbeat-every">
          <span className="heartbeat-select-wrap">
          <select className="heartbeat-select" aria-label="多久一次" value={String(config.intervalMinutes)}
            disabled={busy} onChange={(event) => void write(api.tasks.updateHeartbeat({ requestId: createRequestId(),
              intervalMinutes: Number(event.target.value) as HeartbeatView['config']['intervalMinutes'] }))}>
            {HEARTBEAT_INTERVALS.map((minutes) => <option key={minutes} value={minutes}>{everyLabel(minutes)}</option>)}
          </select>
          <Icon name="chevron-down" size={12} />
          </span>
          <span className="tasks-row-meta">{`${config.quietFrom}–${config.quietTo} 不跳`}</span>
        </span>
      </Field>
      <Field label="模型">
        <span className="heartbeat-model"><ModelPicker purpose="heartbeat" name="心跳的模型" /></span>
      </Field>
      <Field label="看什么">
        <Checklist items={config.items} save={saveItems} />
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
      </Field>
      {view.recent.length === 0 ? null : (
        <Field label="最近">
          <ul className="heartbeat-recent">
            {view.recent.map((beat) => (
              <li key={beat.at} data-failed={beat.failed ? '' : undefined}>
                <span className="heartbeat-recent-at">{clockText(beat.at, timeZone)}</span>{beat.note}
              </li>
            ))}
          </ul>
        </Field>
      )}
      {error === null ? null : <p className="tasks-error" role="alert">{error}</p>}
    </div>
  );
}

/** 任务栏目装上时登记：「定时」里点开心跳那一行用这个弹层。 */
export function registerHeartbeatSheet(): void {
  registerTimedSheet('heartbeat', HeartbeatSheet);
}
