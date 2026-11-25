import type { Migration } from './migrate.ts';

type Speaker = { kind: 'main' } | { kind: 'mate'; id: string };

interface Entry {
  mateLine: string;
  at: string;
  role: 'handoff' | 'lineReport';
  message: Record<string, unknown>;
}

function text(raw: string): string {
  const message = JSON.parse(raw) as { content?: unknown };
  if (typeof message.content === 'string') {
    return message.content;
  }
  if (!Array.isArray(message.content)) {
    return '';
  }
  return message.content.flatMap((part: unknown) => {
    const value = typeof part === 'object' && part !== null ? Reflect.get(part, 'text') : undefined;
    return typeof value === 'string' && !value.startsWith('［附件：') ? [value] : [];
  }).join('\n');
}

export const migration: Migration = {
  id: '0144-mate-relays',
  changes: ['line_messages'],
  up(db) {
    const handed = db.all(`SELECT l.id, l.title, l.mate_id, l.parent_line_id, l.created_at, m.line_id AS mate_line,
        p.mate_id AS parent_mate
      FROM lines l JOIN mates m ON m.id = l.mate_id JOIN lines p ON p.id = l.parent_line_id
      WHERE l.kind = 'background' AND l.resume_parent = 1 AND p.mate_group_id IS NULL
        AND (p.mate_id IS NULL OR p.mate_id <> l.mate_id) AND m.line_id <> p.id`);
    const entries: Entry[] = [];
    for (const row of handed) {
      const id = String(row['id']);
      const mateId = String(row['mate_id']);
      const parent = String(row['parent_line_id']);
      const mateLine = String(row['mate_line']);
      const delegator: Speaker = row['parent_mate'] === null ? { kind: 'main' }
        : { kind: 'mate', id: String(row['parent_mate']) };
      const mate: Speaker = { kind: 'mate', id: mateId };
      const asked = db.all(`SELECT message, created_at FROM line_messages WHERE line_id = $id AND role = 'user'
        ORDER BY seq LIMIT 1`, { id })[0];
      const at = String(asked?.['created_at'] ?? row['created_at']);
      const goal = asked === undefined ? String(row['title']) : text(String(asked['message']));
      entries.push({ mateLine, at, role: 'handoff', message: { role: 'handoff', lineId: id,
        title: String(row['title']), text: goal, relay: { from: delegator, to: mate }, timestamp: Date.parse(at) } });
      const reports = db.all(`SELECT seq, message, created_at FROM line_messages WHERE line_id = $parent
        AND role = 'lineReport' AND json_extract(message, '$.lineId') = $id ORDER BY seq`, { parent, id });
      for (const report of reports) {
        const relay = { from: mate, to: delegator };
        const stored = { ...JSON.parse(String(report['message'])) as Record<string, unknown>, relay };
        db.run('UPDATE line_messages SET message = $message WHERE line_id = $parent AND seq = $seq',
          { message: JSON.stringify(stored), parent, seq: Number(report['seq']) });
        entries.push({ mateLine, at: String(report['created_at']), role: 'lineReport',
          message: { ...stored, own: true } });
      }
    }
    entries.sort((a, b) => a.at.localeCompare(b.at));
    for (const entry of entries) {
      const last = db.all('SELECT MAX(seq) AS seq FROM line_messages WHERE line_id = $line',
        { line: entry.mateLine })[0];
      db.run(`INSERT INTO line_messages (line_id, seq, role, message, meta, created_at)
        VALUES ($line, $seq, $role, $message, NULL, $at)`, { line: entry.mateLine,
        seq: Number(last?.['seq'] ?? 0) + 1, role: entry.role, message: JSON.stringify(entry.message), at: entry.at });
    }
  },
};
