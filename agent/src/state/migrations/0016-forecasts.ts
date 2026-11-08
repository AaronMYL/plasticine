import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0016-forecasts',
  up(db) {
    // 不迁旧预测；只有新版明确创建的可检验命题才开启评分。
    db.exec('ALTER TABLE judgments ADD COLUMN forecast INTEGER NOT NULL DEFAULT 0 CHECK (forecast IN (0, 1))');
    db.exec(`CREATE TABLE forecast_probabilities (
      judgment_id TEXT NOT NULL REFERENCES judgments(id), version INTEGER NOT NULL,
      p REAL NOT NULL CHECK (p BETWEEN 0 AND 1), confirmed_at TEXT NOT NULL,
      PRIMARY KEY (judgment_id, version))`);
    db.exec(`CREATE TABLE forecast_samples (
      judgment_id TEXT PRIMARY KEY REFERENCES judgments(id), snapshot TEXT NOT NULL CHECK (json_valid(snapshot)))`);
    db.exec(`CREATE TABLE forecast_revisions (
      judgment_id TEXT NOT NULL REFERENCES judgments(id), version INTEGER NOT NULL,
      revision TEXT NOT NULL CHECK (json_valid(revision)), PRIMARY KEY (judgment_id, version))`);
  },
};
