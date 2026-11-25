import { Type } from 'typebox';
import {
  IsoTimeSchema,
  Nullable,
  SPACE_GENRES,
  SPACE_HTML_MAX_CHARS,
  SpaceDocSchema,
  SpaceInputSchema,
  SpaceMetadataSchema,
  type SpaceMetadata,
  SpaceRevisionSchema,
  SpaceSchema,
  SPACE_AUTHORS,
  SPACE_TITLE_MAX_CHARS,
  type Page,
  type Space,
  type SpaceAuthor,
  type SpaceDoc,
  type SpaceGenre,
  type SpaceInput,
  type SpaceRevision,
} from '../../shared/state.ts';
import { checked, RECORD_META_COLUMNS, type ColumnMap } from './codec.ts';
import type { Row } from './db.ts';
import { fromSqliteError, notFound, StateError, versionConflict } from './errors.ts';
import { allPages, ObjectStore, type StoreContext, type StoreSpec } from './object-store.ts';
import { isPurged, requireUnpurged } from './purged.ts';

const SpacePatchSchema = Type.Partial(Type.Object({
  ...SpaceMetadataSchema.properties,
  title: Type.String({ minLength: 1, maxLength: SPACE_TITLE_MAX_CHARS }),
  doc: SpaceDocSchema,
  genre: Nullable(Type.Enum(SPACE_GENRES)),
  html: Nullable(Type.String({ minLength: 1, maxLength: SPACE_HTML_MAX_CHARS })),
  author: Type.Enum(SPACE_AUTHORS),
  deletedAt: Nullable(IsoTimeSchema),
}), { additionalProperties: false });

const COLUMNS: ColumnMap = {
  ...RECORD_META_COLUMNS,
  title: 'text',
  category: 'text',
  sourceUrl: 'text',
  bookId: 'text',
  folder: 'text',
  doc: 'json',
  genre: 'text',
  html: 'text',
  author: 'text',
  subscriptionId: 'text',
  issueNumber: 'integer',
  edition: 'text',
  sourceNoteId: 'text',
  deletedAt: 'text',
};

const SPEC: StoreSpec<typeof SpaceSchema, typeof SpaceInputSchema, typeof SpacePatchSchema> = {
  table: 'spaces',
  schema: SpaceSchema,
  input: SpaceInputSchema,
  patch: SpacePatchSchema,
  columns: COLUMNS,
  defaults: { genre: null, html: null, subscriptionId: null, issueNumber: null, edition: null, sourceNoteId: null,
    deletedAt: null, category: 'report', sourceUrl: null, bookId: null, folder: null },
  searchSource: 'space',
};

export interface RevisionNote {
  lineId?: string | null;
  change?: string | null;
  rule?: string | null;
}

export interface SpaceSave extends Partial<SpaceMetadata> {
  title?: string;
  doc?: SpaceDoc;
  genre?: SpaceGenre | null;
  html?: string | null;
}

export interface SpaceListFilter {
  subscriptionId?: string;
  standalone?: boolean;
}

function metadataOf(input: Partial<SpaceMetadata>): Partial<SpaceMetadata> {
  return { ...(input.category === undefined ? {} : { category: input.category }),
    ...(input.sourceUrl === undefined ? {} : { sourceUrl: input.sourceUrl }),
    ...(input.bookId === undefined ? {} : { bookId: input.bookId }),
    ...(input.folder === undefined ? {} : { folder: input.folder }) };
}

function readRevision(row: Row): SpaceRevision {
  const value = {
    spaceId: row['space_id'],
    lineId: row['line_id'] ?? null,
    version: row['version'],
    doc: JSON.parse(String(row['doc'])),
    genre: row['genre'] ?? null,
    html: row['html'] ?? null,
    title: row['title'],
    author: row['author'],
    savedAt: row['saved_at'],
    change: row['change'] ?? null,
    rule: row['rule'] ?? null,
    restoredFrom: row['restored_from'] ?? null,
  };
  return checked(SpaceRevisionSchema, value, 'corrupt_record', `space_revisions ${String(row['space_id'])}`);
}

export function createSpaceStore(context: StoreContext) {
  const spaces = new ObjectStore(context, SPEC);
  const listeners = new Set<(id: string) => void>();
  const changed = (id: string): void => {
    queueMicrotask(() => { for (const listener of listeners) listener(id); });
  };

  function addRevision(space: Space, note: RevisionNote, restoredFrom: number | null): void {
    try {
      context.db.run(`INSERT INTO space_revisions (space_id, version, title, doc, genre, html, author, saved_at,
        change, rule, restored_from, line_id) VALUES ($space, $version, $title, $doc, $genre, $html, $author, $at,
        $change, $rule, $restored, $line)`, {
        space: space.id, version: space.version, title: space.title, doc: JSON.stringify(space.doc),
        genre: space.genre, html: space.html, author: space.author, at: space.updatedAt, change: note.change ?? null,
        rule: note.rule ?? null, restored: restoredFrom, line: note.lineId ?? null,
      });
    } catch (error) {
      throw fromSqliteError(error, '记空间的一版');
    }
  }

  function revision(spaceId: string, version: number): SpaceRevision | undefined {
    const row = context.db.get('SELECT * FROM space_revisions WHERE space_id = $space AND version = $version',
      { space: spaceId, version });
    return row === undefined ? undefined : readRevision(row);
  }

  function save(id: string, expectedVersion: number, input: SpaceSave, author: SpaceAuthor,
    note: RevisionNote = {}, restoredFrom: number | null = null): Space {
    requireUnpurged(context, 'spaces', id);
    return context.db.transaction(() => {
      const current = spaces.require(id);
      if (current.deletedAt !== null) {
        throw new StateError('invalid_input', '这个空间已经删了，先在资料库「最近删除」里还原再改。');
      }
      const updated = spaces.update(id, expectedVersion, { author,
        ...metadataOf(input),
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.doc === undefined ? {} : { doc: input.doc }),
        ...(input.genre === undefined ? {} : { genre: input.genre }),
        ...(input.html === undefined ? {} : { html: input.html }) });
      if (updated.version !== expectedVersion) {
        addRevision(updated, note, restoredFrom);
        changed(updated.id);
      }
      return updated;
    });
  }

  return {
    changed,
    subscribe(listener: (id: string) => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    create(input: SpaceInput, note: RevisionNote = {}, options: { id?: string } = {}): Space {
      return context.db.transaction(() => {
        const created = spaces.create(input, undefined, options.id === undefined ? {} : { id: options.id });
        addRevision(created, note, null);
        changed(created.id);
        return created;
      });
    },
    get: (id: string): Space | undefined => isPurged(context, 'spaces', id) ? undefined : spaces.get(id),
    require: (id: string): Space => {
      requireUnpurged(context, 'spaces', id);
      return spaces.require(id);
    },
    findBySourceUrl(sourceUrl: string, category?: SpaceMetadata['category'], includeDeleted = false):
      Space | undefined {
      return spaces.select((includeDeleted ? '' : 'deleted_at IS NULL AND ') + 'source_url = $url'
        + (category === undefined ? '' : ' AND category = $category'),
      { url: sourceUrl, ...(category === undefined ? {} : { category }) }, { limit: 1 }, 'updated_at DESC')[0];
    },
    forBook: (bookId: string): Space[] => allPages((page) => spaces.select(
      "deleted_at IS NULL AND category = 'booknote' AND book_id = $book", { book: bookId }, page)),
    list(filter: SpaceListFilter = {}, page: Page = {}): Space[] {
      if (filter.subscriptionId !== undefined) {
        return spaces.select('deleted_at IS NULL AND subscription_id = $sub', { sub: filter.subscriptionId }, page,
          'issue_number DESC, created_at DESC, id DESC');
      }
      const where = filter.standalone === true ? 'deleted_at IS NULL AND subscription_id IS NULL'
        : 'deleted_at IS NULL';
      return spaces.select(where, {}, page, 'updated_at DESC, id DESC');
    },
    deleted: (): Space[] => allPages((page) => spaces.select('deleted_at IS NOT NULL AND purged_at IS NULL', {}, page,
      'deleted_at DESC, id DESC')),
    withoutPage: (): Space[] => allPages((page) => spaces.select('deleted_at IS NULL AND html IS NULL', {}, page,
      'created_at ASC, id ASC')),
    issues: (subscriptionId: string): Space[] => allPages((page) => spaces.select(
      'deleted_at IS NULL AND subscription_id = $sub', { sub: subscriptionId }, page,
      'issue_number DESC, created_at DESC, id DESC')),
    nextIssueNumber(subscriptionId: string): number {
      const row = context.db.get('SELECT MAX(issue_number) AS top FROM spaces WHERE subscription_id = $sub',
        { sub: subscriptionId });
      const top = row?.['top'];
      return typeof top === 'number' ? top + 1 : 1;
    },
    save,
    undo(id: string, expectedVersion: number, author: SpaceAuthor): Space {
      requireUnpurged(context, 'spaces', id);
      return context.db.transaction(() => {
        const current = spaces.require(id);
        if (current.version !== expectedVersion) {
          throw versionConflict('spaces', id, expectedVersion, current.version);
        }
        const previous = revision(id, current.version - 1);
        if (previous === undefined) {
          throw new StateError('invalid_input', '这已经是最早的一版，没有可以撤回的改动。');
        }
        return save(id, expectedVersion, { title: previous.title, doc: previous.doc, genre: previous.genre,
          html: previous.html }, author, { change: `撤回到第 ${previous.version} 版` }, previous.version);
      });
    },
    revision,
    revisions(spaceId: string): SpaceRevision[] {
      return context.db.all('SELECT * FROM space_revisions WHERE space_id = $space ORDER BY version DESC',
        { space: spaceId }).map(readRevision);
    },
    markDeleted(id: string, expectedVersion: number): Space {
      requireUnpurged(context, 'spaces', id);
      const current = spaces.get(id);
      if (current === undefined) {
        throw notFound('spaces', id);
      }
      if (current.deletedAt !== null) return current;
      const next = spaces.update(id, expectedVersion, { deletedAt: context.now() });
      changed(id);
      return next;
    },
    restore(id: string): Space {
      requireUnpurged(context, 'spaces', id);
      const current = spaces.get(id);
      if (current === undefined) {
        throw notFound('spaces', id);
      }
      if (current.deletedAt === null) return current;
      const next = spaces.update(id, current.version, { deletedAt: null });
      changed(id);
      return next;
    },
  };
}

export type SpaceStore = ReturnType<typeof createSpaceStore>;
