// 第 102 条设备：动作带上模型写明的用途（判道的依据，留着看）；节点可选上报用户空闲秒数（用户在场让路）；
// 按任务和节点读动作（同一设备失败两次停下、截图点击输入的租约）。只加不改。
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
