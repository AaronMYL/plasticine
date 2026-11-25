import { LOOP_AREAS, normalizeTopic, type LoopArea, type LoopOutcome, type Tally } from '../loop/index.ts';
import type { Row } from './db.ts';
import type { StoreContext } from './object-store.ts';
import { StateError } from './errors.ts';

const EXPECTED_MAX = 400;

export interface LoopRecordInput {
  area: LoopArea;
  topic: string;
  ref?: string | null;
  expected: string;
}

export interface LoopSample {
  topic: string;
  expected: string;
  outcome: LoopOutcome;
  actual: string | null;
  resolvedAt: string;
}

export interface LoopGrant {
  id: string;
  topic: string;
  grantedAt: string;
  sourceAskId: string;
}

function clip(text: string, max: number): string {
  const chars = Array.from(text.trim());
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('')}…`;
}

const str = (row: Row, key: string): string => String(row[key] ?? '');
const optional = (row: Row, key: string): string | null =>
  row[key] === null || row[key] === undefined ? null : String(row[key]);

function sampleOf(row: Row): LoopSample {
  return { topic: str(row, 'topic'), expected: str(row, 'expected'), outcome: str(row, 'outcome') as LoopOutcome,
    actual: optional(row, 'actual'), resolvedAt: str(row, 'resolved_at') };
}

export function createLoopStore(context: StoreContext) {
  const { db } = context;
  const resolveRow = (where: string, params: Record<string, string>, outcome: LoopOutcome,
    actual: string | null): boolean => db.run(`UPDATE loop_records SET outcome = $outcome, actual = $actual,
      resolved_at = $at WHERE ${where} AND outcome IS NULL`, { ...params, outcome,
    actual: actual === null ? null : clip(actual, EXPECTED_MAX), at: context.now() }) > 0;
  return {
    record(input: LoopRecordInput): string | null {
      if (!LOOP_AREAS.includes(input.area)) {
        throw new StateError('invalid_input', `没有这一处：${input.area}`);
      }
      const topic = normalizeTopic(input.topic);
      if (topic === null) {
        return null;
      }
      const ref = input.ref ?? null;
      if (ref !== null) {
        const existing = db.get('SELECT id FROM loop_records WHERE area = $area AND ref = $ref',
          { area: input.area, ref });
        if (existing !== undefined) {
          return str(existing, 'id');
        }
      }
      const id = context.newId();
      db.run(`INSERT INTO loop_records (id, area, topic, ref, expected, created_at)
        VALUES ($id, $area, $topic, $ref, $expected, $at)`, { id, area: input.area, topic, ref,
        expected: clip(input.expected, EXPECTED_MAX), at: context.now() });
      return id;
    },
    resolveById(area: LoopArea, id: string, outcome: LoopOutcome, actual: string | null = null): boolean {
      return resolveRow('id = $id AND area = $area', { id, area }, outcome, actual);
    },
    resolveByRef(area: LoopArea, ref: string, outcome: LoopOutcome, actual: string | null = null): boolean {
      return resolveRow('ref = $ref AND area = $area', { ref, area }, outcome, actual);
    },
    topics(area: LoopArea, limit = 200): string[] {
      return db.all(`SELECT topic FROM loop_records WHERE area = $area GROUP BY topic
        ORDER BY max(created_at) DESC LIMIT $limit`, { area, limit }).map((row) => str(row, 'topic'));
    },
    tallies(area: LoopArea): Tally[] {
      return db.all(`SELECT topic,
          sum(outcome = 'kept') AS kept, sum(outcome = 'changed') AS changed,
          sum(outcome = 'rejected') AS rejected, count(*) AS decided, max(resolved_at) AS last
        FROM loop_records WHERE area = $area AND outcome IS NOT NULL GROUP BY topic ORDER BY topic`, { area })
        .map((row) => ({ topic: str(row, 'topic'), kept: Number(row['kept']), changed: Number(row['changed']),
          rejected: Number(row['rejected']), decided: Number(row['decided']), lastDecidedAt: optional(row, 'last') }));
    },
    outcomes(area: LoopArea, topic: string, limit: number, since: string | null = null): LoopOutcome[] {
      return db.all(`SELECT outcome FROM loop_records WHERE area = $area AND topic = $topic
          AND outcome IS NOT NULL AND ($since IS NULL OR resolved_at > $since)
        ORDER BY resolved_at DESC, created_at DESC LIMIT $limit`,
      { area, topic: normalizeTopic(topic) ?? '', since, limit }).map((row) => str(row, 'outcome') as LoopOutcome);
    },
    samples(area: LoopArea, outcomes: readonly LoopOutcome[], limit: number): LoopSample[] {
      const wanted = outcomes.map((outcome) => `'${outcome}'`).join(', ');
      return db.all(`SELECT * FROM loop_records WHERE area = $area AND outcome IN (${wanted})
        ORDER BY resolved_at DESC, created_at DESC LIMIT $limit`, { area, limit }).map(sampleOf);
    },
    corrections(since: string, limit = 50): (LoopSample & { area: LoopArea })[] {
      return db.all(`SELECT * FROM loop_records WHERE outcome IN ('changed', 'rejected') AND resolved_at > $since
        ORDER BY resolved_at DESC LIMIT $limit`, { since, limit })
        .map((row) => ({ ...sampleOf(row), area: str(row, 'area') as LoopArea }));
    },
    grants: {
      active(topic: string): LoopGrant | undefined {
        const row = db.get(`SELECT * FROM loop_grants WHERE topic = $topic AND revoked_at IS NULL
          ORDER BY granted_at DESC LIMIT 1`, { topic: normalizeTopic(topic) ?? '' });
        return row === undefined ? undefined : { id: str(row, 'id'), topic: str(row, 'topic'),
          grantedAt: str(row, 'granted_at'), sourceAskId: str(row, 'source_ask_id') };
      },
      list(): LoopGrant[] {
        return db.all('SELECT * FROM loop_grants WHERE revoked_at IS NULL ORDER BY granted_at').map((row) => ({
          id: str(row, 'id'), topic: str(row, 'topic'), grantedAt: str(row, 'granted_at'),
          sourceAskId: str(row, 'source_ask_id') }));
      },
      grant(topic: string, deviceId: string, askId: string): LoopGrant {
        const name = normalizeTopic(topic);
        if (name === null || deviceId.trim() === '' || askId.trim() === '') {
          throw new StateError('invalid_input', '放手要有这类事的叫法、他的设备和那张卡。');
        }
        const existing = this.active(name);
        if (existing !== undefined) {
          return existing;
        }
        const id = context.newId();
        const at = context.now();
        db.run(`INSERT INTO loop_grants (id, topic, granted_at, granted_by_device_id, source_ask_id)
          VALUES ($id, $topic, $at, $device, $ask)`, { id, topic: name, at, device: deviceId, ask: askId });
        return { id, topic: name, grantedAt: at, sourceAskId: askId };
      },
      revoke(topic: string, reason: string): boolean {
        return db.run(`UPDATE loop_grants SET revoked_at = $at, revoke_reason = $reason
          WHERE topic = $topic AND revoked_at IS NULL`, { topic: normalizeTopic(topic) ?? '', at: context.now(),
          reason: clip(reason, 200) }) > 0;
      },
      lastRevokedAt(topic: string): string | null {
        const row = db.get(`SELECT max(revoked_at) AS at FROM loop_grants WHERE topic = $topic`,
          { topic: normalizeTopic(topic) ?? '' });
        return row === undefined ? null : optional(row, 'at');
      },
    },
    offers: {
      lastDeclinedAt(topic: string): string | null {
        const row = db.get(`SELECT max(answered_at) AS at FROM asks WHERE purpose = 'loop_offer'
          AND json_extract(context, '$.topic') = $topic AND status = 'answered'
          AND json_extract(answer, '$.optionId') = 'no'`, { topic: normalizeTopic(topic) ?? '' });
        return row === undefined ? null : optional(row, 'at');
      },
      open(topic: string): boolean {
        return db.get(`SELECT 1 AS one FROM asks WHERE purpose = 'loop_offer' AND status = 'open'
          AND json_extract(context, '$.topic') = $topic LIMIT 1`, { topic: normalizeTopic(topic) ?? '' }) !== undefined;
      },
    },
    selfNotes: {
      latest(): { text: string; writtenAt: string } | undefined {
        const row = db.get('SELECT * FROM loop_self_notes ORDER BY written_at DESC, id DESC LIMIT 1');
        return row === undefined ? undefined : { text: str(row, 'text'), writtenAt: str(row, 'written_at') };
      },
      write(text: string): void {
        const body = text.trim();
        if (body === '') {
          throw new StateError('invalid_input', '说明书不能是空的。');
        }
        db.run('INSERT INTO loop_self_notes (id, text, written_at) VALUES ($id, $text, $at)',
          { id: context.newId(), text: clip(body, 4000), at: context.now() });
      },
    },
  };
}

