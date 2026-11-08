// 空间的存取（《优化清单》第 6 条，11-06 定）：一个空间一行，正文是结构化文档；每次保存另记一版（space_revisions），
// 撤销就是把上一版的正文再存成新的一版。删除只打 deleted_at。写都在一个事务里，并告诉统一全文索引（来源 space）。
// 这里不做业务判断：正文合不合规（图表要有来源、[^n] 有对应出处）由 subs/ 在写之前核对。

import { Type } from 'typebox';
import {
  IsoTimeSchema,
  Nullable,
  SpaceDocSchema,
  SpaceInputSchema,
  SpaceRevisionSchema,
  SpaceSchema,
  SPACE_AUTHORS,
  SPACE_TITLE_MAX_CHARS,
  type Page,
  type Space,
  type SpaceAuthor,
  type SpaceDoc,
  type SpaceInput,
  type SpaceRevision,
} from '../../shared/state.ts';
import { checked, RECORD_META_COLUMNS, type ColumnMap } from './codec.ts';
import type { Row } from './db.ts';
import { fromSqliteError, notFound, StateError, versionConflict } from './errors.ts';
import { allPages, ObjectStore, type StoreContext, type StoreSpec } from './object-store.ts';

const SpacePatchSchema = Type.Partial(Type.Object({
  title: Type.String({ minLength: 1, maxLength: SPACE_TITLE_MAX_CHARS }),
  doc: SpaceDocSchema,
  author: Type.Enum(SPACE_AUTHORS),
  deletedAt: Nullable(IsoTimeSchema),
}), { additionalProperties: false });

const COLUMNS: ColumnMap = {
  ...RECORD_META_COLUMNS,
  title: 'text',
  doc: 'json',
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
  defaults: { subscriptionId: null, issueNumber: null, edition: null, sourceNoteId: null, deletedAt: null },
  searchSource: 'space',
};

/** 这一版改了什么、Plasticine 提的「以后都这样」。 */
export interface RevisionNote {
  change?: string | null;
  rule?: string | null;
}

export interface SpaceSave {
  title?: string;
  doc: SpaceDoc;
}

export interface SpaceListFilter {
  subscriptionId?: string;
}

function readRevision(row: Row): SpaceRevision {
  const value = {
    spaceId: row['space_id'],
    version: row['version'],
    doc: JSON.parse(String(row['doc'])),
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
      context.db.run(`INSERT INTO space_revisions (space_id, version, title, doc, author, saved_at, change, rule,
        restored_from) VALUES ($space, $version, $title, $doc, $author, $at, $change, $rule, $restored)`, {
        space: space.id, version: space.version, title: space.title, doc: JSON.stringify(space.doc),
        author: space.author, at: space.updatedAt, change: note.change ?? null, rule: note.rule ?? null,
        restored: restoredFrom,
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
    return context.db.transaction(() => {
      const current = spaces.require(id);
      if (current.deletedAt !== null) {
        throw new StateError('invalid_input', '这个空间已经删了，先恢复再改。');
      }
      const updated = spaces.update(id, expectedVersion, { doc: input.doc, author,
        ...(input.title === undefined ? {} : { title: input.title }) });
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
    get: (id: string): Space | undefined => spaces.get(id),
    require: (id: string): Space => spaces.require(id),
    /** 没删的，最近改的在前。 */
    list(filter: SpaceListFilter = {}, page: Page = {}): Space[] {
      if (filter.subscriptionId !== undefined) {
        return spaces.select('deleted_at IS NULL AND subscription_id = $sub', { sub: filter.subscriptionId }, page,
          'issue_number DESC, created_at DESC, id DESC');
      }
      return spaces.select('deleted_at IS NULL', {}, page, 'updated_at DESC, id DESC');
    },
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
      return context.db.transaction(() => {
        const current = spaces.require(id);
        if (current.version !== expectedVersion) {
          throw versionConflict('spaces', id, expectedVersion, current.version);
        }
        const previous = revision(id, current.version - 1);
        if (previous === undefined) {
          throw new StateError('invalid_input', '这已经是最早的一版，没有可以撤回的改动。');
        }
        return save(id, expectedVersion, { title: previous.title, doc: previous.doc }, author,
          { change: `撤回到第 ${previous.version} 版` }, previous.version);
      });
    },
    revision,
    /** 全部版本，新的在前。 */
    revisions(spaceId: string): SpaceRevision[] {
      return context.db.all('SELECT * FROM space_revisions WHERE space_id = $space ORDER BY version DESC',
        { space: spaceId }).map(readRevision);
    },
    markDeleted(id: string, expectedVersion: number): Space {
      const current = spaces.get(id);
      if (current === undefined) {
        throw notFound('spaces', id);
      }
      return current.deletedAt !== null ? current
        : spaces.update(id, expectedVersion, { deletedAt: context.now() });
    },
  };
}

export type SpaceStore = ReturnType<typeof createSpaceStore>;
