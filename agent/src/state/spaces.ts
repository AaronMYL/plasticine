// 空间的存取（《优化清单》第 6 条，11-06 定；第 8 批第 6 条 11-09 改成整页网页）：一个空间一行，正文是 body 里的
// 网页片段（html，体裁 genre）；旧空间重写以前还是结构化文档（doc）。每次保存另记一版（space_revisions），撤销就是把
// 上一版的正文再存成新的一版。删除只打 deleted_at。写都在一个事务里，并告诉统一全文索引（来源 space）。
// 这里不做业务判断：正文的清洗、合不合规由 subs/ 在写之前做。

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

/** 这一版改了什么、Plasticine 提的「以后都这样」。 */
export interface RevisionNote {
  lineId?: string | null;
  change?: string | null;
  rule?: string | null;
}

/** 存一版：网页版给 genre 和 html；只改名就只给 title。doc 只在撤回到旧版时跟着回去。 */
export interface SpaceSave extends Partial<SpaceMetadata> {
  title?: string;
  doc?: SpaceDoc;
  genre?: SpaceGenre | null;
  html?: string | null;
}

export interface SpaceListFilter {
  subscriptionId?: string;
  /** 只要不属于订阅的（资料库第二栏「空间」一组）。 */
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
      }
      return updated;
    });
  }

  return {
    create(input: SpaceInput, note: RevisionNote = {}, options: { id?: string } = {}): Space {
      return context.db.transaction(() => {
        const created = spaces.create(input, undefined, options.id === undefined ? {} : { id: options.id });
        addRevision(created, note, null);
        return created;
      });
    },
    get: (id: string): Space | undefined => isPurged(context, 'spaces', id) ? undefined : spaces.get(id),
    require: (id: string): Space => { requireUnpurged(context, 'spaces', id); return spaces.require(id); },
    findBySourceUrl(sourceUrl: string, category?: SpaceMetadata['category'], includeDeleted = false):
      Space | undefined {
      return spaces.select((includeDeleted ? '' : 'deleted_at IS NULL AND ') + 'source_url = $url'
        + (category === undefined ? '' : ' AND category = $category'),
      { url: sourceUrl, ...(category === undefined ? {} : { category }) }, { limit: 1 }, 'updated_at DESC')[0];
    },
    forBook: (bookId: string): Space[] => allPages((page) => spaces.select(
      "deleted_at IS NULL AND category = 'booknote' AND book_id = $book", { book: bookId }, page)),
    /** 没删的，最近改的在前。 */
    list(filter: SpaceListFilter = {}, page: Page = {}): Space[] {
      if (filter.subscriptionId !== undefined) {
        return spaces.select('deleted_at IS NULL AND subscription_id = $sub', { sub: filter.subscriptionId }, page,
          'issue_number DESC, created_at DESC, id DESC');
      }
      const where = filter.standalone === true ? 'deleted_at IS NULL AND subscription_id IS NULL'
        : 'deleted_at IS NULL';
      return spaces.select(where, {}, page, 'updated_at DESC, id DESC');
    },
    /** 删掉的（「最近删除」），删的时间新的在前。 */
    deleted: (): Space[] => allPages((page) => spaces.select('deleted_at IS NOT NULL AND purged_at IS NULL', {}, page,
      'deleted_at DESC, id DESC')),
    /** 还没有网页版的（旧版式），先建的在前：一次性重写找它们。 */
    withoutPage: (): Space[] => allPages((page) => spaces.select('deleted_at IS NULL AND html IS NULL', {}, page,
      'created_at ASC, id ASC')),
    /** 一个订阅的全部各期，新的在前。 */
    issues: (subscriptionId: string): Space[] => allPages((page) => spaces.select(
      'deleted_at IS NULL AND subscription_id = $sub', { sub: subscriptionId }, page,
      'issue_number DESC, created_at DESC, id DESC')),
    /** 下一期是第几期（删掉的也占号，期号不重用）。 */
    nextIssueNumber(subscriptionId: string): number {
      const row = context.db.get('SELECT MAX(issue_number) AS top FROM spaces WHERE subscription_id = $sub',
        { sub: subscriptionId });
      const top = row?.['top'];
      return typeof top === 'number' ? top + 1 : 1;
    },
    save,
    /** 撤销最近一版：把它前一版的正文和标题再存成新的一版。 */
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
    /** 全部版本，新的在前。 */
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
      return current.deletedAt !== null ? current
        : spaces.update(id, expectedVersion, { deletedAt: context.now() });
    },
    /** 从「最近删除」还原：清掉删除时间（版本加一）；本来就没删的原样返回。 */
    restore(id: string): Space {
      requireUnpurged(context, 'spaces', id);
      const current = spaces.get(id);
      if (current === undefined) {
        throw notFound('spaces', id);
      }
      return current.deletedAt === null ? current : spaces.update(id, current.version, { deletedAt: null });
    },
  };
}

export type SpaceStore = ReturnType<typeof createSpaceStore>;
