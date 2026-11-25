import { createHash } from 'node:crypto';
import type { Row } from '../db.ts';
import type { Migration, MigrationDb, MigrationFiles } from './migrate.ts';

const FOLDER = 'Plasticine 写的';
const DELIVERED = ['delivered', 'partially_delivered'];
const TITLE_MAX_CHARS = 80;
const PREVIEW_MAX_CHARS = 120;

function text(row: Row, key: string): string {
  const value = row[key];
  return typeof value === 'string' ? value : '';
}

function parse(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function titleOf(markdown: string): string {
  const lines = markdown.split('\n').map((line) => line.replace(/^#+\s*/, '').replace(/[*_`>]/g, '').trim());
  const first = (lines.find((line) => line !== '') ?? '').slice(0, TITLE_MAX_CHARS);
  return first === '' ? '新笔记' : first;
}

function previewOf(markdown: string): string {
  return markdown.split('\n').slice(1).join(' ')
    .replace(/```[\s\S]*?```/g, '［图表］')
    .replace(/!\[[^\]]*]\([^)]*\)/g, '［图片］')
    .replace(/[#*_`>|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PREVIEW_MAX_CHARS);
}

function bodyOf(db: MigrationDb, row: Row): string | null {
  const location = parse(text(row, 'location'));
  const verification = parse(text(row, 'verification'));
  if (location?.['kind'] !== 'text' || typeof location['text'] !== 'string' || location['text'].trim() === '') {
    return null;
  }
  if (verification?.['status'] === 'refuted') {
    return null;
  }
  const taskId = row['source_task_id'];
  if (typeof taskId === 'string') {
    const task = db.all('SELECT status FROM tasks WHERE id = $id', { id: taskId })[0];
    if (task === undefined || !DELIVERED.includes(text(task, 'status'))) {
      return null;
    }
  }
  const summary = text(row, 'summary').trim();
  return [`# ${text(row, 'title')}`, summary, location['text'].trim()].filter((part) => part !== '').join('\n\n');
}

const SAFE_NOTE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;

export function noteIdFor(artifactId: string): string {
  if (SAFE_NOTE_ID.test(artifactId)) {
    return artifactId;
  }
  return `artifact-${createHash('sha256').update(artifactId).digest('hex').slice(0, 24)}`;
}

function moveOne(db: MigrationDb, files: MigrationFiles, row: Row, markdown: string): void {
  const id = noteIdFor(text(row, 'id'));
  if (db.all('SELECT id FROM notes WHERE id = $id', { id }).length > 0) {
    return;
  }
  const body = files.writeNoteBody(id, markdown);
  const legacy = JSON.stringify({ artifactKind: text(row, 'kind'), summary: text(row, 'summary'),
    sourceTaskId: row['source_task_id'] ?? null });
  db.run(`INSERT INTO notes (id, created_at, updated_at, version, migrated_default, legacy_payload, title, folder,
    author, preview, body_file, body_bytes, body_sha256)
    VALUES ($id, $created, $updated, 1, 1, $legacy, $title, $folder, 'ai', $preview, $file, $bytes, $sha)`, {
    id, created: text(row, 'created_at'), updated: text(row, 'updated_at'), legacy, title: titleOf(markdown),
    folder: FOLDER, preview: previewOf(markdown), file: body.file, bytes: body.bytes, sha: body.sha256,
  });
  db.run(`INSERT INTO note_versions (note_id, version, body_file, body_bytes, body_sha256, author, saved_at)
    VALUES ($id, 1, $file, $bytes, $sha, 'ai', $at)`, {
    id, file: body.file, bytes: body.bytes, sha: body.sha256, at: text(row, 'updated_at'),
  });
}

export const migration: Migration = {
  id: '0061-artifact-notes',
  up(db, files) {
    for (const row of db.all('SELECT * FROM artifacts ORDER BY created_at, id')) {
      const markdown = bodyOf(db, row);
      if (markdown !== null) {
        moveOne(db, files, row, markdown);
      }
    }
  },
};
