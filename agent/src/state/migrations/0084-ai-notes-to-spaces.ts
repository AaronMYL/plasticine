import type { Row } from '../db.ts';
import type { Migration, MigrationDb, MigrationFiles } from './migrate.ts';

const FOLDER = 'Plasticine 写的';
const TEXT_MAX = 40_000;
const BLOCKS_MAX = 400;
const TITLE_MAX = 120;
const HEADING_MAX = 200;

type Block = { type: 'heading'; id: string; text: string } | { type: 'text'; markdown: string };

function text(row: Row, key: string): string {
  const value = row[key];
  return typeof value === 'string' ? value : '';
}

function textBlocks(markdown: string): Block[] {
  const trimmed = markdown.trim();
  if (trimmed === '') {
    return [];
  }
  const blocks: Block[] = [];
  let current = '';
  for (const part of trimmed.split(/\n{2,}/)) {
    const piece = part.length > TEXT_MAX ? part.slice(0, TEXT_MAX) : part;
    if (current !== '' && current.length + piece.length + 2 > TEXT_MAX) {
      blocks.push({ type: 'text', markdown: current });
      current = '';
    }
    current = current === '' ? piece : `${current}\n\n${piece}`;
  }
  if (current !== '') {
    blocks.push({ type: 'text', markdown: current });
  }
  return blocks;
}

export function docOfMarkdown(title: string, markdown: string): { stats: []; blocks: Block[]; sources: [] } {
  const lines = markdown.split('\n');
  const first = lines.findIndex((line) => line.trim() !== '');
  if (first >= 0 && /^#\s+/.test(lines[first] ?? '') && (lines[first] ?? '').replace(/^#\s+/, '').trim() === title) {
    lines.splice(first, 1);
  }
  const blocks: Block[] = [];
  let buffer: string[] = [];
  let sections = 0;
  const flush = (): void => {
    blocks.push(...textBlocks(buffer.join('\n')));
    buffer = [];
  };
  let fence = false;
  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      fence = !fence;
    }
    const heading = fence ? null : /^##\s+(.+)$/.exec(line);
    if (heading?.[1] !== undefined) {
      flush();
      sections += 1;
      blocks.push({ type: 'heading', id: `s${sections}`, text: heading[1].trim().slice(0, HEADING_MAX) });
    } else {
      buffer.push(line);
    }
  }
  flush();
  if (blocks.length > BLOCKS_MAX) {
    const rest = blocks.splice(BLOCKS_MAX - 1).map((block) => (block.type === 'heading' ? `## ${block.text}`
      : block.markdown)).join('\n\n');
    blocks.push(...textBlocks(rest).slice(0, 1));
  }
  return { stats: [], blocks, sources: [] };
}

function moveOne(db: MigrationDb, files: MigrationFiles, note: Row): void {
  const noteId = text(note, 'id');
  if (db.all('SELECT id FROM spaces WHERE source_note_id = $id', { id: noteId }).length > 0) {
    return;
  }
  if (files.readNoteBody === undefined) {
    throw new Error('这个库没有笔记目录，读不了要迁成空间的笔记正文');
  }
  const title = (text(note, 'title').trim() || '未命名').slice(0, TITLE_MAX);
  const doc = JSON.stringify(docOfMarkdown(title, files.readNoteBody(text(note, 'body_file'))));
  const spaceId = `sp-${noteId}`;
  const author = text(note, 'author') === 'user' ? 'user' : 'ai';
  const created = text(note, 'created_at');
  const updated = text(note, 'updated_at');
  db.run(`INSERT INTO spaces (id, created_at, updated_at, version, title, doc, author, subscription_id, issue_number,
    edition, source_note_id, deleted_at)
    VALUES ($id, $created, $updated, 1, $title, $doc, $author, NULL, NULL, NULL, $note, NULL)`,
  { id: spaceId, created, updated, title, doc, author, note: noteId });
  db.run(`INSERT INTO space_revisions (space_id, version, title, doc, author, saved_at, change, rule, restored_from)
    VALUES ($id, 1, $title, $doc, $author, $at, NULL, NULL, NULL)`, { id: spaceId, title, doc, author, at: updated });
  db.run('UPDATE notes SET moved_to_space_id = $space WHERE id = $id', { space: spaceId, id: noteId });
  const mark = db.all('SELECT * FROM visibility_marks WHERE id = $id', { id: `note:${noteId}` })[0];
  if (mark !== undefined) {
    db.run(`INSERT OR IGNORE INTO visibility_marks (id, created_at, updated_at, version, object_kind, object_id, tier,
      proposed, confirmed_at) VALUES ($id, $created, $updated, 1, 'space', $object, $tier, $proposed, $confirmed)`, {
      id: `space:${spaceId}`, created: text(mark, 'created_at'), updated: text(mark, 'updated_at'), object: spaceId,
      tier: text(mark, 'tier'), proposed: mark['proposed'] ?? null, confirmed: mark['confirmed_at'] ?? null,
    });
  }
}

export const migration: Migration = {
  id: '0084-ai-notes-to-spaces',
  up(db, files) {
    const notes = db.all(`SELECT * FROM notes WHERE folder = $folder AND deleted_at IS NULL
      AND moved_to_space_id IS NULL ORDER BY created_at, id`, { folder: FOLDER });
    for (const note of notes) {
      moveOne(db, files, note);
    }
    db.run(`UPDATE note_folders SET retired_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE name = $folder AND retired_at IS NULL`, { folder: FOLDER });
  },
};
