// M5 甲路：设备服务和自迭代。只加表（10-26 第 25 条）。
// - nodes：配对过的执行节点（Mac / 浏览器上的设备服务），和登录用的 devices 分开（《应用架构方案》第 10 节「App 登录身份与
//   设备执行身份分别管理」）。长期凭证只存散列；上限是用户确认字段，带确认它的设备和时间。
// - node_pairing_codes：App 上签名领的一次性码，只存散列；同一次领码请求重发时旧码作废（voided_at）。
// - node_actions：每个设备动作一行，action_id 唯一：同一标识重复到达返回已有状态，不重做（第 5 节「动作幂等」）。
// - self_changes：一次自迭代一行，挂在 tasks 上；编号唯一，分支 self/<编号>。
// 枚举值不写 CHECK：动作种类里有 file_delete，迁移守卫按词拦 DELETE；值由 shared/ 的 schema 在写入前校验。

import type { Migration } from './migrate.ts';
import { CONFIRMATION_COLUMNS, jsonColumn, RECORD_COLUMNS } from './sql.ts';

const NODES = `CREATE TABLE nodes (${RECORD_COLUMNS},
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  app_version TEXT NOT NULL,
  protocol_version INTEGER NOT NULL CHECK (protocol_version >= 1),
  ${jsonColumn('capabilities', false)},
  credential_hash TEXT NOT NULL UNIQUE,
  pairing_code_id TEXT NOT NULL,
  paired_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  ${jsonColumn('limits', true)},
  limits_version INTEGER NOT NULL DEFAULT 0 CHECK (limits_version >= 0),
  ${CONFIRMATION_COLUMNS}
)`;

const NODE_PAIRING_CODES = `CREATE TABLE node_pairing_codes (${RECORD_COLUMNS},
  code_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  issued_by_device_id TEXT NOT NULL REFERENCES devices (id),
  used_at TEXT,
  node_id TEXT REFERENCES nodes (id),
  voided_at TEXT,
  CHECK ((used_at IS NULL) = (node_id IS NULL))
)`;

const NODE_ACTIONS = `CREATE TABLE node_actions (${RECORD_COLUMNS},
  action_id TEXT NOT NULL UNIQUE,
  node_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  action_class TEXT NOT NULL,
  target TEXT NOT NULL,
  params_digest TEXT NOT NULL,
  status TEXT NOT NULL,
  origin TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  refusal_layer TEXT,
  reason TEXT,
  ${jsonColumn('result', true)},
  task_id TEXT,
  run_id TEXT,
  delivered_at TEXT,
  executed_at TEXT
)`;

const SELF_CHANGES = `CREATE TABLE self_changes (${RECORD_COLUMNS},
  number INTEGER NOT NULL UNIQUE CHECK (number >= 1),
  task_id TEXT NOT NULL REFERENCES tasks (id),
  goal TEXT NOT NULL,
  branch TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  action_id TEXT UNIQUE,
  round INTEGER NOT NULL DEFAULT 0 CHECK (round >= 0),
  note TEXT,
  ${jsonColumn('files', false)},
  diff TEXT,
  ${jsonColumn('checks', true)},
  ${jsonColumn('shots', false)},
  ${jsonColumn('twin', true)},
  classification TEXT,
  ${jsonColumn('labels', false)},
  ${jsonColumn('violations', false)},
  ask_id TEXT,
  decision TEXT,
  decided_by_device_id TEXT,
  decided_at TEXT,
  release_ref TEXT,
  rollback_point TEXT,
  error TEXT
)`;

const STATEMENTS = [
  NODES,
  NODE_PAIRING_CODES,
  NODE_ACTIONS,
  'CREATE INDEX node_actions_usage ON node_actions (node_id, action_class, requested_at)',
  SELF_CHANGES,
  'CREATE INDEX self_changes_task ON self_changes (task_id)',
];

export const migration: Migration = {
  id: '0011-devices-self',
  up(db) {
    for (const statement of STATEMENTS) {
      db.exec(statement);
    }
  },
};
