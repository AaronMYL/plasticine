import { Value } from 'typebox/value';
import { LineInputOriginSchema, type LineInputOrigin, type QueueStatus } from '../../shared/api/lines.ts';
import type { Row } from './db.ts';
import type { StoreContext } from './object-store.ts';

export interface QueuedRow {
  id: string;
  lineId: string;
  text: string;
  attachments: string[];
  origin: LineInputOrigin;
  status: QueueStatus;
  sentSeq: number | null;
  createdAt: string;
  updatedAt: string;
}

function queuedOf(row: Row): QueuedRow {
  const sent = row['sent_seq'];
  const origin: unknown = typeof row['origin'] === 'string' ? JSON.parse(row['origin']) : null;
  return {
    id: String(row['id']),
    lineId: String(row['line_id']),
    text: String(row['text']),
    attachments: JSON.parse(String(row['attachments'])) as string[],
    origin: Value.Check(LineInputOriginSchema, origin) ? origin : { kind: 'unknown' },
    status: String(row['status']) as QueueStatus,
    sentSeq: sent === null || sent === undefined ? null : Number(sent),
    createdAt: String(row['created_at']),
    updatedAt: String(row['updated_at']),
  };
}

export function createLineQueueTable(context: StoreContext) {
  const { db } = context;
  const get = (id: string): QueuedRow | undefined => {
    const row = db.get('SELECT * FROM line_queue WHERE id = $id', { id });
    return row === undefined ? undefined : queuedOf(row);
  };
  const setStatus = (id: string, status: QueueStatus, sentSeq: number | null): QueuedRow => {
    db.run('UPDATE line_queue SET status = $status, sent_seq = $sentSeq, updated_at = $at WHERE id = $id',
      { id, status, sentSeq, at: context.now() });
    return get(id)!;
  };
  return {
    get,
    add(lineId: string, text: string, attachments: readonly string[],
      origin: LineInputOrigin = { kind: 'unknown' }): QueuedRow {
      const id = `queued-${context.newId()}`;
      const at = context.now();
      db.run(`INSERT INTO line_queue (id, line_id, text, attachments, origin, status, created_at, updated_at)
        VALUES ($id, $lineId, $text, $attachments, $origin, 'queued', $at, $at)`,
      { id, lineId, text, attachments: JSON.stringify(attachments), origin: JSON.stringify(origin), at });
      return get(id)!;
    },
    queued(lineId: string): QueuedRow[] {
      return db.all(`SELECT * FROM line_queue WHERE line_id = $lineId AND status IN ('queued', 'inserted')
        ORDER BY created_at, id`, { lineId }).map(queuedOf);
    },
    sent(id: string, seq: number): QueuedRow {
      return setStatus(id, 'sent', seq);
    },
    withdraw(id: string): QueuedRow {
      return setStatus(id, 'withdrawn', null);
    },
    insert(id: string): QueuedRow {
      return setStatus(id, 'inserted', null);
    },
    linesWithQueued(): string[] {
      return db.all(`SELECT line_id, MIN(created_at) AS first FROM line_queue WHERE status IN ('queued', 'inserted')
        GROUP BY line_id ORDER BY first`).map((row) => String(row['line_id']));
    },
  };
}
