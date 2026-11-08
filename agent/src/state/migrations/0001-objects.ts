// First batch (M0), part 1: sources and five of the six core objects (《从零方案》第 4 节;《实施方案》第 4 节).
// The enumerations are written out here instead of imported from shared/: this file is history and must keep
// creating the same tables even if a shared list later grows (a grown list needs a new column, not an edit).
// Only sets fixed by the plans get a CHECK; open-ended ones (evidence kind, channel …) are checked by schema.

import type { Migration } from './migrate.ts';
import {
  booleanColumn,
  CONFIRMATION_COLUMNS,
  inList,
  jsonColumn,
  OBJECT_COLUMNS,
  probabilityColumn,
} from './sql.ts';

// 10-26 第 62 条：w 按来源给，库里用 CHECK 把来源类别和 w 绑死。
const SOURCES = `CREATE TABLE sources (${OBJECT_COLUMNS},
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  ref TEXT,
  w REAL NOT NULL CHECK (
    (kind IN ${inList(['reality_outcome', 'user_said', 'user_confirmed'])} AND w = 1)
    OR (kind IN ${inList(['independent_statement', 'verifiable_original'])} AND w = 0.5)
    OR (kind IN ${inList(['own_reasoning', 'ai_conversation'])} AND w = 0.1)
  )
)`;

const CONCERNS = `CREATE TABLE concerns (${OBJECT_COLUMNS},
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ${inList(['goal', 'commitment', 'open_question', 'exploration'])}),
  why TEXT NOT NULL,
  initiator TEXT NOT NULL CHECK (initiator IN ${inList(['user', 'brain'])}),
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ${inList(['watching', 'active', 'pending_close', 'closed'])}),
  ${jsonColumn('activities', false)},
  ${jsonColumn('wait_conditions', false)},
  ${jsonColumn('trigger_conditions', false)},
  ${jsonColumn('completion_criteria', true)},
  channel TEXT NOT NULL,
  understanding TEXT,
  ${booleanColumn('referenced_by_user', 0)},
  ${jsonColumn('agreement_ids', false)}
)`;

const JUDGMENTS = `CREATE TABLE judgments (${OBJECT_COLUMNS},${CONFIRMATION_COLUMNS},
  concern_id TEXT REFERENCES concerns (id),
  statement TEXT NOT NULL,
  explanation TEXT NOT NULL,
  uncertainty TEXT,
  ${jsonColumn('verification', false)},
  ${jsonColumn('disagreement', true)},
  ${booleanColumn('stale', 0)},
  applicability TEXT,
  ${probabilityColumn('p')},
  ${probabilityColumn('proposed_p')},
  ${probabilityColumn('prior')},
  deadline TEXT,
  status TEXT NOT NULL CHECK (status IN ${inList(['active', 'deferred', 'retired'])}),
  outcome TEXT CHECK (outcome IS NULL OR outcome IN ${inList(['happened', 'not_happened', 'void'])}),
  outcome_at TEXT
)`;

const EVIDENCE = `CREATE TABLE evidence (${OBJECT_COLUMNS},
  content TEXT NOT NULL,
  identity TEXT NOT NULL CHECK (identity IN ${inList(['quote', 'observation', 'fact', 'speculation', 'agreement'])}),
  kind TEXT NOT NULL,
  source_id TEXT NOT NULL REFERENCES sources (id),
  observed_at TEXT NOT NULL,
  ${jsonColumn('stances', false)},
  ${jsonColumn('scope', false)},
  ref TEXT,
  digest TEXT,
  task_id TEXT REFERENCES tasks (id),
  ${booleanColumn('stale', 0)}
)`;

const AGREEMENTS = `CREATE TABLE agreements (${OBJECT_COLUMNS},${CONFIRMATION_COLUMNS},
  kind TEXT NOT NULL CHECK (kind IN ${inList(['collaboration', 'term'])}),
  title TEXT,
  text TEXT NOT NULL,
  scope TEXT NOT NULL,
  user_quote TEXT,
  quoted_at TEXT,
  ${booleanColumn('per_use_confirmation', 0)},
  ${jsonColumn('premises', false)},
  state TEXT NOT NULL CHECK (state IN ${inList(['active', 'under_review', 'revoked'])}),
  proposed_diff TEXT,
  effective_at TEXT
)`;

const MEMORY_ENTRIES = `CREATE TABLE memory_entries (${OBJECT_COLUMNS},
  text TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ${inList(['quote', 'interpretation'])}),
  basis TEXT NOT NULL CHECK (basis IN ${inList(['self_reported', 'inferred'])}),
  source_id TEXT NOT NULL REFERENCES sources (id),
  provenance TEXT NOT NULL,
  observation_kind TEXT,
  ${jsonColumn('anchor', true)},
  applicability TEXT,
  ${booleanColumn('stale', 0)},
  ${jsonColumn('related', false)},
  deleted_at TEXT
)`;

const INDEXES = [
  'CREATE INDEX concerns_lifecycle ON concerns (lifecycle)',
  'CREATE INDEX judgments_concern ON judgments (concern_id)',
  'CREATE INDEX evidence_source ON evidence (source_id)',
  'CREATE INDEX evidence_task ON evidence (task_id)',
  'CREATE INDEX agreements_state ON agreements (state)',
  'CREATE INDEX memory_entries_source ON memory_entries (source_id)',
];

export const migration: Migration = {
  id: '0001-objects',
  up(db) {
    for (const statement of [SOURCES, CONCERNS, JUDGMENTS, EVIDENCE, AGREEMENTS, MEMORY_ENTRIES, ...INDEXES]) {
      db.exec(statement);
    }
  },
};
