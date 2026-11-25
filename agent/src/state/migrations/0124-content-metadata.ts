import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0124-content-metadata',
  up(db) {
    db.exec("ALTER TABLE spaces ADD COLUMN category TEXT NOT NULL DEFAULT 'report'");
    db.exec('ALTER TABLE spaces ADD COLUMN source_url TEXT');
    db.exec('ALTER TABLE spaces ADD COLUMN book_id TEXT');
    db.exec('ALTER TABLE spaces ADD COLUMN folder TEXT');
    db.exec('ALTER TABLE books ADD COLUMN folder TEXT');
    db.exec("UPDATE spaces SET category = 'letter' WHERE genre = 'letter'");
    db.exec('CREATE INDEX spaces_source_url ON spaces (source_url, category)');
    db.exec('CREATE INDEX spaces_book_id ON spaces (book_id, category)');
  },
};
