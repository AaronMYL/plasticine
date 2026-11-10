// 笔记（《实施方案》第 4 节迁移规则 5）：正文是 notes/ 下的文件，元数据是 notes 表的一行，行里记着文件的字节数和
// SHA-256。保存先核版本，再写文件（临时文件改名），最后改行；删除只打 deleted_at，行和文件都留着。
// 标题和摘要照旧版（1ca0391 agent/src/notes.ts 的 titleOf / previewOf）从正文算出，界面列表直接用。

import {
  NoteCreateOptionsSchema,
  NoteInputSchema,
  NotePatchSchema,
  NoteRecordSchema,
  NoteVersionSchema,
  PageSchema,
  type NoteCreateOptions,
  type NoteInput,
  type NotePatch,
  type NoteRecord,
  type NoteVersion,
  type Page,
} from '../../shared/state.ts';
import {
  checked,
  columnName,
  definedEntries,
  encodeRow,
  OBJECT_META_COLUMNS,
  readRow,
  sqlColumns,
  type ColumnMap,
} from './codec.ts';
import type { Params } from './db.ts';
import { fromSqliteError, notFound, StateError, versionConflict } from './errors.ts';
import type { BodyDigest, NoteBodies } from './note-bodies.ts';
import { createNoteFolders, type NoteReadable } from './note-folders.ts';
import { createNoteImportDetails } from './note-import-details.ts';
import { noteAssetRefs } from './note-asset-refs.ts';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, type StoreContext } from './object-store.ts';

const COLUMNS: ColumnMap = {
  ...OBJECT_META_COLUMNS,
  title: 'text',
  folder: 'text',
  pinned: 'boolean',
  private: 'boolean',
  readOnly: 'boolean',
  author: 'text',
  preview: 'text',
  bodyFile: 'text',
  bodyBytes: 'integer',
  bodySha256: 'text',
  deletedAt: 'text',
};
const INSERT_SQL = (() => {
  const { names, placeholders } = sqlColumns(COLUMNS);
  return `INSERT INTO notes (${names}) VALUES (${placeholders})`;
})();

const VERSION_COLUMNS: ColumnMap = {
  noteId: 'text',
  version: 'integer',
  bodyFile: 'text',
  bodyBytes: 'integer',
  bodySha256: 'text',
  author: 'text',
  savedAt: 'text',
  restoredFromVersion: 'integer',
};
const VERSION_INSERT = (() => {
  const { names, placeholders } = sqlColumns(VERSION_COLUMNS);
  return `INSERT INTO note_versions (${names}) VALUES (${placeholders})`;
})();

// Old notebook values: a title is the first non-empty line, at most 80 characters; a preview is 120.
const TITLE_MAX_CHARS = 80;
const PREVIEW_MAX_CHARS = 120;
export const UNTITLED_NOTE = '新笔记';
const READ_ONLY_MESSAGE = '这是合并前的原版，只读。要改请打开合并后的那篇。';

export function titleOf(markdown: string): string {
  const lines = markdown.split('\n').map((line) => {
    return line.replace(/^#+\s*/, '').replace(/[*_`>]/g, '').trim();
  });
  const first = lines.find((line) => line !== '') ?? '';
  const title = first.slice(0, TITLE_MAX_CHARS);
  return title === '' ? UNTITLED_NOTE : title;
}

export function previewOf(markdown: string): string {
  return markdown
    .split('\n')
    .slice(1)
    .join(' ')
    .replace(/```[\s\S]*?```/g, '［图表］')
    .replace(/!\[[^\]]*]\([^)]*\)/g, '［图片］')
    .replace(/[#*_`>|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PREVIEW_MAX_CHARS);
}

export interface NoteFilter {
  includeDeleted?: boolean;
  folder?: string;
  q?: string;
  deletedOnly?: boolean;
  readable?: NoteReadable;
}

const MOVED_OUT = 'moved_to_space_id IS NULL';

export function createNoteStore(context: StoreContext, bodies: NoteBodies) {
  // 单对象恢复会只读早于永久删除功能的快照，不能假定历史快照也有新列。
  const unpurged = context.db.all('PRAGMA table_info(notes)').some((row) => row['name'] === 'purged_at')
    ? 'purged_at IS NULL' : '1 = 1';
  function get(id: string): NoteRecord | undefined {
    const row = context.db.get(`SELECT * FROM notes WHERE id = $id AND ${unpurged}`, { id });
    return row === undefined ? undefined : readRow(NoteRecordSchema, COLUMNS, row, 'notes');
  }

  function require(id: string): NoteRecord {
    const found = get(id);
    if (found === undefined) {
      throw notFound('notes', id);
    }
    return found;
  }

  function write(sql: string, params: Params, what: string): number {
    try {
      return context.db.run(sql, params);
    } catch (error) {
      throw fromSqliteError(error, what);
    }
  }

  function bodyFields(markdown: string, digest: BodyDigest) {
    return {
      title: titleOf(markdown),
      preview: previewOf(markdown),
      bodyBytes: digest.bytes,
      bodySha256: digest.sha256,
    };
  }

  function create(input: NoteInput, options: NoteCreateOptions = {}): NoteRecord {
    const values = checked(NoteInputSchema, input, 'invalid_input', '新建笔记');
    const extra = checked(NoteCreateOptionsSchema, options, 'invalid_input', '新建笔记的选项');
    const id = extra.id ?? context.newId();
    if (context.db.get('SELECT id FROM notes WHERE id = $id', { id }) !== undefined) {
      throw new StateError('duplicate', `notes 里已经有 ${id}`, { field: 'id' });
    }
    const createdAt = extra.createdAt ?? context.now();
    const bodyFile = bodies.fileFor(id);
    // The text goes to disk before the row: a row never points at a body that was not written.
    const digest = bodies.write(bodyFile, values.markdown);
    const record = {
      id,
      createdAt,
      updatedAt: extra.updatedAt ?? createdAt,
      version: 1,
      migratedDefault: extra.migratedDefault ?? false,
      legacyPayload: extra.legacyPayload ?? null,
      folder: values.folder,
      pinned: values.pinned ?? false,
      private: values.private ?? false,
      readOnly: values.readOnly ?? false,
      author: values.author,
      bodyFile,
      deletedAt: null,
      ...bodyFields(values.markdown, digest),
    };
    let stored: NoteRecord;
    try {
      stored = checked(NoteRecordSchema, record, 'invalid_input', '新建笔记');
      const row = stored;
      context.db.transaction(() => {
        write(INSERT_SQL, encodeRow(COLUMNS, row), '新建笔记');
        recordVersion(row);
        context.index?.changed('note', row.id);
      });
    } catch (error) {
      bodies.discardUnstored(bodyFile);
      throw error;
    }
    return stored;
  }

  function commit(current: NoteRecord, changes: Record<string, unknown>, what: string): NoteRecord {
    const next = checked(
      NoteRecordSchema,
      { ...current, ...changes, updatedAt: context.now(), version: current.version + 1 },
      'invalid_input',
      what,
    );
    const fields = ['updatedAt', 'version', ...Object.keys(changes)];
    const assignments = fields.map((field) => `${columnName(field)} = $${columnName(field)}`).join(', ');
    const params = encodeRow(Object.fromEntries(fields.map((field) => [field, COLUMNS[field] ?? 'text'])), next);
    const sql = `UPDATE notes SET ${assignments} WHERE id = $id AND version = $expected_version`;
    if (write(sql, { ...params, id: current.id, expected_version: current.version }, what) !== 1) {
      throw versionConflict('notes', current.id, current.version, get(current.id)?.version ?? current.version);
    }
    context.index?.changed('note', current.id);
    return next;
  }

  /** The user's save. `expectedVersion` is the version the editor started from; a mismatch is a 409 upstream. */
  function saveAs(id: string, expectedVersion: number, patch: NotePatch, author: 'user' | 'ai'): NoteRecord {
    const values = definedEntries(checked(NotePatchSchema, patch, 'invalid_input', '保存笔记'));
    const current = require(id);
    if (current.version !== expectedVersion) {
      throw versionConflict('notes', id, expectedVersion, current.version);
    }
    if (current.deletedAt !== null) {
      throw new StateError('invalid_input', '这篇笔记已经删除，不能再改', { field: 'id' });
    }
    if (current.readOnly && (values['markdown'] !== undefined || values['folder'] !== undefined)) {
      throw new StateError('invalid_input', READ_ONLY_MESSAGE, { field: 'markdown' });
    }
    const restoredFrom = patch.restoredFromVersion;
    if (restoredFrom !== undefined) {
      const source = versions(id).find((row) => row.version === restoredFrom);
      if (source === undefined || bodies.read(source.bodyFile) !== patch.markdown) {
        throw new StateError('invalid_input', '恢复的内容与历史版本不一致，请重新选择版本。');
      }
    }
    const changes: Record<string, unknown> = {};
    for (const field of ['folder', 'pinned'] as const) {
      if (values[field] !== undefined && values[field] !== current[field]) {
        changes[field] = values[field];
      }
    }
    const markdown = values['markdown'];
    if (typeof markdown !== 'string'
      || bodies.inspect(current.bodyFile) !== undefined && markdown === bodies.read(current.bodyFile)) {
      if (Object.keys(changes).length === 0) {
        return current;
      }
      return context.db.transaction(() => commit(current, changes, '保存笔记'));
    }
    // A new file for the new version (review-followups e4cef52): the row's pointer and the version row move to it in
    // one transaction; a refused or failed save leaves the old file, the old pointer and the old version together.
    const version = current.version + 1;
    const bodyFile = bodies.versionFileFor(id, version);
    const digest = bodies.write(bodyFile, markdown, true);
    try {
      return context.db.transaction(() => {
        const body = { ...bodyFields(markdown, digest), author, bodyFile };
        const saved = commit(current, { ...changes, ...body }, '保存笔记');
        recordVersion(saved, restoredFrom);
        return saved;
      });
    } catch (error) {
      bodies.discardUnstored(bodyFile);
      throw error;
    }
  }

  function recordVersion(note: NoteRecord, restoredFromVersion?: number): void {
    const row = checked(
      NoteVersionSchema,
      {
        noteId: note.id,
        version: note.version,
        bodyFile: note.bodyFile,
        bodyBytes: note.bodyBytes,
        bodySha256: note.bodySha256,
        author: note.author,
        savedAt: note.updatedAt,
        restoredFromVersion: restoredFromVersion ?? null,
      },
      'invalid_input',
      '记笔记版本',
    );
    write(VERSION_INSERT, encodeRow(VERSION_COLUMNS, row), '记笔记版本');
  }

  function versions(noteId: string): NoteVersion[] {
    const sql = 'SELECT * FROM note_versions WHERE note_id = $id ORDER BY version DESC';
    return context.db.all(sql, { id: noteId }).map((row) => {
      return readRow(NoteVersionSchema, VERSION_COLUMNS, row, 'note_versions');
    });
  }

  /** Marks the note deleted; the row and its file stay. Deleting twice keeps the first time. */
  function markDeleted(id: string): NoteRecord {
    const current = require(id);
    if (current.deletedAt !== null) {
      return current;
    }
    return context.db.transaction(() => commit(current, { deletedAt: context.now() }, '删除笔记'));
  }

  /** Pinned first, then the most recently changed. */
  function list(filter: NoteFilter = {}, page: Page = {}): NoteRecord[] {
    const { limit = DEFAULT_PAGE_SIZE, offset = 0 } = checked(PageSchema, page, 'invalid_input', '分页参数');
    if (limit > MAX_PAGE_SIZE) {
      throw new StateError('invalid_input', `一页最多 ${MAX_PAGE_SIZE} 条`, { field: 'limit' });
    }
    // 迁成空间的笔记（0084，moved_to_space_id）哪个列表里都不再出现；行和正文都留着。
    const clauses = filter.includeDeleted === true ? [MOVED_OUT] : ['deleted_at IS NULL', MOVED_OUT];
    if (filter.deletedOnly === true) {
      clauses.splice(0, clauses.length, 'deleted_at IS NOT NULL', MOVED_OUT);
    }
    clauses.push(unpurged);
    const params: Params = { limit, offset };
    if (filter.folder !== undefined) {
      clauses.push('folder = $folder');
      params['folder'] = filter.folder;
    }
    const where = clauses.length === 0 ? '1 = 1' : clauses.join(' AND ');
    const sql = `SELECT * FROM notes WHERE ${where}
      ORDER BY pinned DESC, updated_at DESC, id DESC LIMIT $limit OFFSET $offset`;
    const query = filter.q?.trim().toLocaleLowerCase() ?? '';
    if (query === '') {
      return context.db.all(sql, params).map((row) => readRow(NoteRecordSchema, COLUMNS, row, 'notes'));
    }
    const all = context.db.all(`SELECT * FROM notes WHERE ${where} ORDER BY pinned DESC, updated_at DESC, id DESC`,
      filter.folder === undefined ? {} : { folder: filter.folder });
    return all.map((row) => readRow(NoteRecordSchema, COLUMNS, row, 'notes'))
      .filter((note) => (filter.readable?.(note) ?? true)
        && bodies.read(note.bodyFile).toLocaleLowerCase().includes(query))
      .slice(offset, offset + limit);
  }

  return {
    create,
    get,
    require,
    save: (id: string, version: number, patch: NotePatch) => saveAs(id, version, patch, 'user'),
    saveAs,
    restore(id: string): NoteRecord {
      const current = require(id);
      return current.deletedAt === null ? current
        : context.db.transaction(() => commit(current, { deletedAt: null }, '恢复笔记'));
    },
    folders: createNoteFolders(context, (from, to) => {
      const rows = context.db.all('SELECT id FROM notes WHERE folder = $folder AND purged_at IS NULL',
        { folder: from });
      for (const row of rows) { commit(require(String(row['id'])), { folder: to }, '移动文件夹里的笔记'); }
    }),
    importDetails: createNoteImportDetails(context, require),
    markDeleted,
    list,
    readBody: (note: NoteRecord): string => bodies.read(note.bodyFile),
    /** Saved versions, newest first (notes saved before 0011 have rows only from then on). */
    versions,
    /** The text of one saved version; undefined when that version has no row. */
    readVersion(noteId: string, version: number): { version: NoteVersion; markdown: string } | undefined {
      const found = versions(noteId).find((row) => row.version === version);
      return found === undefined ? undefined : { version: found, markdown: bodies.read(found.bodyFile) };
    },
    /** What is on disk for the note now, to compare with the row's byte count and SHA-256. */
    inspectBody: (note: NoteRecord): BodyDigest | undefined => bodies.inspect(note.bodyFile),
    readAsset: bodies.readAsset.bind(bodies),
    writeAsset: bodies.writeAsset.bind(bodies),
    assetPath: bodies.assetPath.bind(bodies),
    /** 查找私密笔记当前正文和历史版本里的图片引用。 */
    privateAssetNotes(name: string, origin?: string): string[] {
      const rows = context.db.all('SELECT id FROM notes WHERE private = 1 AND purged_at IS NULL');
      return rows.map((row) => String(row['id'])).filter((id) => {
        const files = new Set([require(id).bodyFile, ...versions(id).map((version) => version.bodyFile)]);
        return [...files].some((file) => {
          const text = bodies.read(file);
          return noteAssetRefs(text, origin).has(name);
        });
      });
    },
    /** The notes directory itself; only the importer needs it (to place copied pictures). */
    directory: (): string => bodies.directory,
  };
}

export type NoteStore = ReturnType<typeof createNoteStore>;
