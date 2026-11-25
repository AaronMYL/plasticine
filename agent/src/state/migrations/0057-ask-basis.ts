import type { Migration } from './migrate.ts';
import { inList } from './sql.ts';

const BASES = ['inferred', 'options', 'missing', 'hard_line'];

export const migration: Migration = {
  id: '0057-ask-basis',
  up(db) {
    db.exec(`ALTER TABLE asks ADD COLUMN basis TEXT CHECK (basis IS NULL OR basis IN ${inList(BASES)})`);
  },
};
