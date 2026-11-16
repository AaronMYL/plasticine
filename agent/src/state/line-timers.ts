// 线的两种定时（迁移 0145）：到点叫醒（line_wakes）和盯着变化（line_watches）。同一次调用重跑（call_key）认回同一行。

import type { Row } from './db.ts';
import type { StoreContext } from './object-store.ts';
import { StateError } from './errors.ts';

export interface LineWake {
  id: string;
  lineId: string;
  dueAt: string;
  note: string;
  status: 'waiting' | 'woken' | 'cancelled';
  createdAt: string;
  endedAt: string | null;
}

export interface LineWatch {
  id: string;
  lineId: string;
  title: string;
  /** 看公网上的这一页；和 tab 恰好有一样。 */
  url: string | null;
  /** 看 Mac 上这个网页标签（要他登录的页面）。 */
  tab: { nodeId: string; tabId: string } | null;
  /** 看 Mac 上授权文件夹里的这个文件夹（迁移 0146）：多了、少了、改了文件就叫。 */
  folder: { nodeId: string; path: string } | null;
  /** 等这段字出现；没有就是页面有变化就叫。 */
  lookFor: string | null;
  everyMinutes: number;
  untilAt: string;
  nextAt: string;
  status: 'on' | 'off' | 'ended';
  checks: number;
  changes: number;
  lastText: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
  endedAt: string | null;
}

function text(row: Row, key: string): string {
  return String(row[key]);
}

function maybe(row: Row, key: string): string | null {
  const value = row[key];
  return value === null || value === undefined ? null : String(value);
}

function wakeOf(row: Row): LineWake {
  return { id: text(row, 'id'), lineId: text(row, 'line_id'), dueAt: text(row, 'due_at'), note: text(row, 'note'),
    status: text(row, 'status') as LineWake['status'], createdAt: text(row, 'created_at'),
    endedAt: maybe(row, 'ended_at') };
}

function watchOf(row: Row): LineWatch {
  const nodeId = maybe(row, 'node_id');
  const tabId = maybe(row, 'tab_id');
  const folder = maybe(row, 'folder');
  return { id: text(row, 'id'), lineId: text(row, 'line_id'), title: text(row, 'title'), url: maybe(row, 'url'),
    tab: nodeId === null || tabId === null ? null : { nodeId, tabId },
    folder: nodeId === null || folder === null ? null : { nodeId, path: folder }, lookFor: maybe(row, 'look_for'),
    everyMinutes: Number(row['every_minutes']), untilAt: text(row, 'until_at'), nextAt: text(row, 'next_at'),
    status: text(row, 'status') as LineWatch['status'], checks: Number(row['checks']),
    changes: Number(row['changes']), lastText: maybe(row, 'last_text'), lastCheckedAt: maybe(row, 'last_checked_at'),
    lastError: maybe(row, 'last_error'), createdAt: text(row, 'created_at'), endedAt: maybe(row, 'ended_at') };
}

export interface WatchInput {
  lineId: string;
  callKey: string;
  title: string;
  url: string | null;
  tab: { nodeId: string; tabId: string } | null;
  folder?: { nodeId: string; path: string } | null;
  lookFor: string | null;
  everyMinutes: number;
  untilAt: string;
}

/** 一次检查的结果：看到的字（存下来下次比）、有没有变、下次什么时候看；ended 为真就不再看了。 */
export interface WatchCheck {
  text: string | null;
  changed: boolean;
  error: string | null;
  nextAt: string;
  ended: boolean;
}

export function createLineTimerStores(context: StoreContext) {
  const { db } = context;
  const wake = (id: string): LineWake | undefined => {
    const row = db.get('SELECT * FROM line_wakes WHERE id = $id', { id });
    return row === undefined ? undefined : wakeOf(row);
  };
  const watch = (id: string): LineWatch | undefined => {
    const row = db.get('SELECT * FROM line_watches WHERE id = $id', { id });
    return row === undefined ? undefined : watchOf(row);
  };
  return {
    wakes: {
      get: wake,
      /** 同一次调用再来一次回原来那一行，不另建。 */
      add(input: { lineId: string; callKey: string; dueAt: string; note: string }): LineWake {
        const prior = db.get('SELECT * FROM line_wakes WHERE call_key = $key', { key: input.callKey });
        if (prior !== undefined) {
          return wakeOf(prior);
        }
        const id = `wake_${context.newId()}`;
        db.run(`INSERT INTO line_wakes (id, line_id, call_key, due_at, note, status, created_at)
          VALUES ($id, $line, $key, $due, $note, 'waiting', $now)`, { id, line: input.lineId, key: input.callKey,
          due: input.dueAt, note: input.note, now: context.now() });
        return wake(id) as LineWake;
      },
      waiting(): LineWake[] {
        return db.all("SELECT * FROM line_wakes WHERE status = 'waiting' ORDER BY due_at, id").map(wakeOf);
      },
      due(at: string): LineWake[] {
        return db.all("SELECT * FROM line_wakes WHERE status = 'waiting' AND due_at <= $at ORDER BY due_at, id",
          { at }).map(wakeOf);
      },
      /** 叫过了或撤了：只改还在等的那一行。 */
      end(id: string, status: 'woken' | 'cancelled'): LineWake {
        db.run("UPDATE line_wakes SET status = $status, ended_at = $now WHERE id = $id AND status = 'waiting'",
          { id, status, now: context.now() });
        const row = wake(id);
        if (row === undefined) {
          throw new StateError('not_found', '没有这一条「回来看」。');
        }
        return row;
      },
    },
    watches: {
      get: watch,
      add(input: WatchInput): LineWatch {
        const prior = db.get('SELECT * FROM line_watches WHERE call_key = $key', { key: input.callKey });
        if (prior !== undefined) {
          return watchOf(prior);
        }
        const id = `watch_${context.newId()}`;
        const now = context.now();
        db.run(`INSERT INTO line_watches (id, line_id, call_key, title, url, node_id, tab_id, folder, look_for,
          every_minutes, until_at, next_at, status, created_at) VALUES ($id, $line, $key, $title, $url, $node, $tab,
          $folder, $look,
          $every, $until, $now, 'on', $now)`, { id, line: input.lineId, key: input.callKey, title: input.title,
          url: input.url, node: input.tab?.nodeId ?? input.folder?.nodeId ?? null, tab: input.tab?.tabId ?? null,
          folder: input.folder?.path ?? null, look: input.lookFor,
          every: input.everyMinutes, until: input.untilAt, now });
        return watch(id) as LineWatch;
      },
      byCall(callKey: string): LineWatch | undefined {
        const row = db.get('SELECT * FROM line_watches WHERE call_key = $key', { key: callKey });
        return row === undefined ? undefined : watchOf(row);
      },
      on(): LineWatch[] {
        return db.all("SELECT * FROM line_watches WHERE status = 'on' ORDER BY next_at, id").map(watchOf);
      },
      due(at: string): LineWatch[] {
        return db.all("SELECT * FROM line_watches WHERE status = 'on' AND next_at <= $at ORDER BY next_at, id",
          { at }).map(watchOf);
      },
      forLine(lineId: string): LineWatch[] {
        return db.all("SELECT * FROM line_watches WHERE line_id = $line AND status = 'on' ORDER BY created_at, id",
          { line: lineId }).map(watchOf);
      },
      checked(id: string, check: WatchCheck): LineWatch {
        db.run(`UPDATE line_watches SET checks = checks + 1, changes = changes + $changed,
          last_text = COALESCE($text, last_text), last_error = $error, last_checked_at = $now, next_at = $next,
          status = CASE WHEN $ended = 1 THEN 'ended' ELSE status END,
          ended_at = CASE WHEN $ended = 1 THEN $now ELSE ended_at END WHERE id = $id AND status = 'on'`,
        { id, changed: check.changed ? 1 : 0, text: check.text, error: check.error, now: context.now(),
          next: check.nextAt, ended: check.ended ? 1 : 0 });
        return watch(id) as LineWatch;
      },
      /** 他关掉或线自己停：只改还开着的。 */
      stop(id: string): LineWatch {
        db.run("UPDATE line_watches SET status = 'off', ended_at = $now WHERE id = $id AND status = 'on'",
          { id, now: context.now() });
        const row = watch(id);
        if (row === undefined) {
          throw new StateError('not_found', '没有这一条「盯着」。');
        }
        return row;
      },
    },
  };
}
