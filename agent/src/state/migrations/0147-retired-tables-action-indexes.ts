import type { Migration } from './migrate.ts';

const RETIRED_TABLES = [
  'trigger_dispositions', 'triggers', 'intake_sources', 'rule_events', 'rules',
  'pairing_codes', 'mail_fallback_settings', 'notification_mail_status', 'client_updates',
] as const;

const SEEN_KEYS = `UPDATE timed_slots SET memo = json_set(memo, '$.seen', json((
    SELECT json_group_array(COALESCE((SELECT substr(seen.value, 1, 5) || t.ref_id FROM triggers t
      WHERE (seen.value LIKE 'mail:%' OR seen.value LIKE 'feed:%') AND t.id = substr(seen.value, 6)
        AND t.ref_id IS NOT NULL), seen.value))
    FROM json_each(timed_slots.memo, '$.seen') seen)))
  WHERE source = 'heartbeat' AND json_type(memo, '$.seen') = 'array'`;

const IPHONE_ONLY_KINDS = ['photo_list', 'photo_read', 'location_current'] as const;

export const migration: Migration = {
  id: '0147-retired-tables-action-indexes',
  destructive: true,
  changes: [...RETIRED_TABLES, 'node_actions'],
  up(db) {
    db.exec('CREATE INDEX node_actions_requested ON node_actions (requested_at, id)');
    db.exec('CREATE INDEX node_actions_run_node ON node_actions (run_id, node_id, requested_at)');
    db.exec(SEEN_KEYS);
    db.exec('PRAGMA secure_delete = ON');
    try {
      for (const table of RETIRED_TABLES) {
        db.exec(`DROP TABLE ${table}`);
      }
      db.exec(`DELETE FROM node_actions WHERE kind IN (${IPHONE_ONLY_KINDS.map((kind) => `'${kind}'`).join(', ')})`);
    } finally {
      db.exec('PRAGMA secure_delete = OFF');
    }
  },
};
