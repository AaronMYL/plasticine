import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0042-device-lanes',
  up(db) {
    db.exec('ALTER TABLE node_actions ADD COLUMN purpose TEXT');
    db.exec('ALTER TABLE nodes ADD COLUMN idle_seconds INTEGER CHECK (idle_seconds IS NULL OR idle_seconds >= 0)');
    db.exec('ALTER TABLE nodes ADD COLUMN idle_reported_at TEXT');
    db.exec('CREATE INDEX node_actions_task_node ON node_actions (task_id, node_id, requested_at)');
    db.exec('CREATE INDEX node_actions_node_kind ON node_actions (node_id, kind, requested_at)');
  },
};
