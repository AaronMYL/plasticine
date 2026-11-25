import type { Row } from '../db.ts';
import type { Migration, MigrationDb } from './migrate.ts';

const MAIN_LINE_ID = 'line-main';
const MAIN_LINE_TITLE = '主对话';
const MAIN_CHAT_ID = 'main';
const SHIFT_PARK = 1_000_000_000;
const ATTACHMENT_NOTE_START = '［附件：';

type Json = Record<string, unknown>;

function text(row: Row, key: string): string {
  const value = row[key];
  return typeof value === 'string' ? value : '';
}

function parse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(object: Json, ...keys: string[]): string {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === 'string') {
      return value.trim();
    }
  }
  return '';
}

function cardLines(cards: unknown): string[] {
  if (!Array.isArray(cards)) {
    return [];
  }
  return cards.flatMap((card) => {
    const title = isObject(card) ? stringField(card, 'title', '标题') : '';
    return title === '' ? [] : [`· ${title}`];
  });
}

function layersText(value: unknown): string | null {
  if (!isObject(value)) {
    return null;
  }
  const conclusion = stringField(value, 'conclusion', '结论');
  const reasoning = stringField(value, 'reasoning', '理由');
  if (conclusion === '' && reasoning === '') {
    return null;
  }
  const cards = cardLines(value['cards'] ?? value['卡片']);
  return [conclusion, reasoning, cards.join('\n')].filter((part) => part !== '').join('\n\n');
}

function unfenced(content: string): string {
  const fenced = /^```(?:json)?[ \t]*\n([\s\S]*?)\n?```$/.exec(content.trim());
  return fenced?.[1] ?? content.trim();
}

function replyText(row: Row): string {
  const layers = row['reply_layers'] === null ? null : layersText(parse(text(row, 'reply_layers')));
  if (layers !== null) {
    return layers;
  }
  const content = text(row, 'content');
  return layersText(parse(unfenced(content))) ?? content.trim();
}

function attachmentsOf(row: Row): { id: string; name: string }[] {
  const value = parse(text(row, 'attachments'));
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!isObject(item) || typeof item['ref'] !== 'string') {
      return [];
    }
    const name = typeof item['name'] === 'string' && item['name'] !== '' ? item['name'] : '附件';
    return [{ id: item['ref'], name }];
  });
}

function userMessage(row: Row, at: number): Json {
  const content = text(row, 'content');
  const attachments = attachmentsOf(row);
  if (attachments.length === 0) {
    return { role: 'user', content, timestamp: at };
  }
  const names = attachments.map((item) => `「${item.name}」`).join('、');
  const ids = attachments.map((item) => item.id).join(', ');
  const note = `${ATTACHMENT_NOTE_START}${names}；id：${ids}；正文用 attachment_text 读］`;
  return { role: 'user', content: [{ type: 'text', text: content }, { type: 'text', text: note }], timestamp: at };
}

const NO_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function assistantMessage(body: string, at: number): Json {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: body }],
    api: 'plasticine-migrated',
    provider: 'plasticine-migrated',
    model: 'plasticine-old',
    usage: NO_USAGE,
    stopReason: 'stop',
    timestamp: at,
  };
}

function ensureMainLine(db: MigrationDb, at: string): void {
  if (db.all('SELECT id FROM lines WHERE id = $id', { id: MAIN_LINE_ID }).length > 0) {
    return;
  }
  db.run(`INSERT INTO lines (id, created_at, updated_at, kind, title, status)
    VALUES ($id, $at, $at, 'main', $title, 'idle')`, { id: MAIN_LINE_ID, at, title: MAIN_LINE_TITLE });
}

function shiftExisting(db: MigrationDb, count: number, refs: Map<string, string>): void {
  const existing = db.all('SELECT seq FROM line_messages WHERE line_id = $id ORDER BY seq', { id: MAIN_LINE_ID });
  if (existing.length === 0) {
    return;
  }
  const params = { id: MAIN_LINE_ID, park: SHIFT_PARK, count };
  db.run('UPDATE line_messages SET seq = seq + $park WHERE line_id = $id', params);
  db.run('UPDATE line_messages SET seq = seq - $park + $count WHERE line_id = $id', params);
  db.run('UPDATE line_queue SET sent_seq = sent_seq + $count WHERE line_id = $id AND sent_seq IS NOT NULL', params);
  db.run('UPDATE lines SET summary_seq = summary_seq + $count WHERE id = $id AND summary_seq > 0', params);
  for (const row of existing) {
    const seq = Number(row['seq']);
    refs.set(`line:${MAIN_LINE_ID}:${seq}`, `line:${MAIN_LINE_ID}:${seq + count}`);
  }
}

function moveMessages(db: MigrationDb, rows: readonly Row[], refs: Map<string, string>): void {
  let seq = 0;
  const entries: { row: Row; message: Json }[] = [];
  for (const row of rows) {
    const at = Date.parse(text(row, 'sent_at'));
    if (row['role'] === 'user') {
      entries.push({ row, message: userMessage(row, at) });
      continue;
    }
    const body = replyText(row);
    if (body !== '') {
      entries.push({ row, message: assistantMessage(body, at) });
    }
  }
  shiftExisting(db, entries.length, refs);
  for (const { row, message } of entries) {
    seq += 1;
    db.run(`INSERT INTO line_messages (line_id, seq, role, message, created_at)
      VALUES ($line, $seq, $role, $message, $at)`, {
      line: MAIN_LINE_ID, seq, role: text(row, 'role'), message: JSON.stringify(message), at: text(row, 'sent_at'),
    });
    refs.set(text(row, 'id'), `line:${MAIN_LINE_ID}:${seq}`);
  }
}

function remapAnchor(anchor: unknown, refs: ReadonlyMap<string, string>): unknown {
  if (!isObject(anchor) || anchor['kind'] !== 'message' || typeof anchor['ref'] !== 'string') {
    return anchor;
  }
  const ref = refs.get(anchor['ref']);
  return ref === undefined ? anchor : { ...anchor, ref };
}

function remapColumn(db: MigrationDb, table: string, key: string, column: string,
  remap: (value: unknown) => unknown): void {
  const rows = db.all(`SELECT ${key} AS key, ${column} AS value FROM ${table} WHERE ${column} IS NOT NULL`);
  for (const row of rows) {
    const before = text(row, 'value');
    const after = JSON.stringify(remap(parse(before)));
    if (after !== before && after !== 'null') {
      db.run(`UPDATE ${table} SET ${column} = $value WHERE ${key} = $key`, { value: after, key: row['key'] ?? null });
    }
  }
}

function remapRefs(db: MigrationDb, refs: ReadonlyMap<string, string>): void {
  const anchors = (value: unknown): unknown => (Array.isArray(value)
    ? value.map((anchor) => remapAnchor(anchor, refs)) : value);
  remapColumn(db, 'memory_doc_lines', 'id', 'anchors', anchors);
  remapColumn(db, 'memory_inferences', 'id', 'anchors', anchors);
  remapColumn(db, 'memory_entries', 'id', 'anchor', (value) => remapAnchor(value, refs));
  remapColumn(db, 'term_decodings', 'id', 'anchor', (value) => remapAnchor(value, refs));
  remapColumn(db, 'memory_curation_jobs', 'id', 'source_ids', (value) => (Array.isArray(value)
    ? value.map((id) => (typeof id === 'string' ? refs.get(id) ?? id : id)) : value));
  const replies = db.all('SELECT id, reply_id FROM memory_curation_jobs WHERE reply_id IS NOT NULL');
  for (const row of replies) {
    const ref = refs.get(text(row, 'reply_id'));
    if (ref !== undefined) {
      db.run('UPDATE memory_curation_jobs SET reply_id = $ref WHERE id = $id', { ref, id: row['id'] ?? null });
    }
  }
}

export const migration: Migration = {
  id: '0059-main-line',
  up(db) {
    const rows = db.all(`SELECT id, role, content, sent_at, reply_layers, attachments FROM messages
      WHERE chat_id = $chat AND active = 1 AND role IN ('user', 'assistant') ORDER BY sent_at, id`,
    { chat: MAIN_CHAT_ID });
    if (rows.length === 0) {
      return;
    }
    ensureMainLine(db, text(rows[0]!, 'sent_at'));
    const refs = new Map<string, string>();
    moveMessages(db, rows, refs);
    remapRefs(db, refs);
  },
};
