import type { Migration } from './migrate.ts';
export const migration: Migration = {
  id: '0025-self-code',
  up(db) {
    db.exec(`CREATE TABLE self_jobs (id TEXT PRIMARY KEY, change_id TEXT NOT NULL,
      round INTEGER NOT NULL, payload TEXT NOT NULL, UNIQUE(change_id, round))`);
    db.exec(`CREATE TABLE self_deploy_approvals (id TEXT PRIMARY KEY, job_id TEXT NOT NULL UNIQUE,
      payload TEXT NOT NULL)`);
  },
};
