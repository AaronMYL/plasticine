// Soul 的存取（迁移 0139，第13批）：主线（owner = main）和每位队友（owner = 队友 id）各一份全文和改动记录。改一次记一条：
// 谁改的、改前改后、一句说明；撤回只撤「之后没再改过」的那一次，撤回本身也记一条。只存取，不判断谁能改。

import type { SoulActor } from '../../shared/api/souls.ts';
import { SOUL_TEXT_MAX_CHARS } from '../../shared/soul-text.ts';
import type { Row } from './db.ts';
import { StateError } from './errors.ts';
import type { StoreContext } from './object-store.ts';

export interface SoulRow {
  owner: string;
  text: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface SoulRevisionRow {
  id: string;
  owner: string;
  actor: SoulActor;
  before: string;
  after: string;
  note: string;
  at: string;
  undoneAt: string | null;
  undoes: string | null;
}

const str = (row: Row, key: string): string => String(row[key] ?? '');
const optional = (row: Row, key: string): string | null => row[key] === null || row[key] === undefined ? null
  : String(row[key]);

function soulOf(row: Row): SoulRow {
  return { owner: str(row, 'owner'), text: str(row, 'text'), version: Number(row['version']),
    createdAt: str(row, 'created_at'), updatedAt: str(row, 'updated_at') };
}

function revisionOf(row: Row): SoulRevisionRow {
  return { id: str(row, 'id'), owner: str(row, 'owner'), actor: str(row, 'actor') as SoulActor,
    before: str(row, 'before'), after: str(row, 'after'), note: str(row, 'note'), at: str(row, 'at'),
    undoneAt: optional(row, 'undone_at'), undoes: optional(row, 'undoes') };
}

function checkText(text: string): string {
  const body = text.replace(/\s+$/u, '');
  if (body.trim() === '') {
    throw new StateError('invalid_input', 'Soul 不能是空的。');
  }
  if (Array.from(body).length > SOUL_TEXT_MAX_CHARS) {
    throw new StateError('invalid_input', `Soul 最多 ${String(SOUL_TEXT_MAX_CHARS)} 字。`);
  }
  return body;
}

export function createSoulStore(context: StoreContext) {
  const { db } = context;
  const get = (owner: string): SoulRow | undefined => {
    const row = db.get('SELECT * FROM souls WHERE owner = $owner', { owner });
    return row === undefined ? undefined : soulOf(row);
  };
  const revision = (id: string): SoulRevisionRow | undefined => {
    const row = db.get('SELECT * FROM soul_revisions WHERE id = $id', { id });
    return row === undefined ? undefined : revisionOf(row);
  };
  const record = (owner: string, actor: SoulActor, before: string, after: string, note: string,
    undoes: string | null = null): SoulRevisionRow => {
    const id = context.newId();
    db.run(`INSERT INTO soul_revisions (id, owner, actor, before, after, note, at, undoes)
      VALUES ($id, $owner, $actor, $before, $after, $note, $at, $undoes)`,
    { id, owner, actor, before, after, note: Array.from(note).slice(0, 300).join(''), at: context.now(), undoes });
    return revision(id)!;
  };
  const write = (owner: string, version: number, text: string, actor: SoulActor, note: string,
    undoes: string | null = null): { soul: SoulRow; revision: SoulRevisionRow | null } => {
    const current = get(owner);
    if (current === undefined) {
      throw new StateError('not_found', '这份 Soul 不在了。');
    }
    if (current.version !== version) {
      throw new StateError('version_conflict', 'Soul 刚刚改过，请看一眼现在的再改。');
    }
    const body = checkText(text);
    if (body === current.text) {
      return { soul: current, revision: null };
    }
    db.run(`UPDATE souls SET text = $text, version = version + 1, updated_at = $at
      WHERE owner = $owner AND version = $version`, { owner, version, text: body, at: context.now() });
    return { soul: get(owner)!, revision: record(owner, actor, current.text, body, note, undoes) };
  };
  return {
    get,
    revision,
    /** 没有就照给的文字建一份（新队友、迁移以后才有的队友）。 */
    ensure(owner: string, text: string): SoulRow {
      return db.transaction(() => {
        const found = get(owner);
        if (found !== undefined) {
          return found;
        }
        const at = context.now();
        const body = checkText(text);
        db.run(`INSERT INTO souls (owner, text, version, created_at, updated_at)
          VALUES ($owner, $text, 1, $at, $at)`, { owner, text: body, at });
        record(owner, 'system', '', body, '起步');
        return get(owner)!;
      });
    },
    /** 改一次：版本对不上不改；文字没变不记。 */
    write(owner: string, version: number, text: string, actor: SoulActor, note: string):
      { soul: SoulRow; revision: SoulRevisionRow | null } {
      return db.transaction(() => write(owner, version, text, actor, note));
    },
    /** 最近的改动，新的在前。 */
    revisions(owner: string, limit: number): SoulRevisionRow[] {
      // 只加不改的记录：按写进来的先后排（迁移写的起步用的是库的时钟，和服务的时钟可能对不齐）。
      return db.all('SELECT * FROM soul_revisions WHERE owner = $owner ORDER BY rowid DESC LIMIT $limit',
        { owner, limit }).map(revisionOf);
    },
    /** 撤回一次：起步那次、撤过的、撤回本身不能撤；之后又改过（现在不是它改成的样子）也不能撤。 */
    undo(id: string, note: string): { soul: SoulRow; revision: SoulRevisionRow | null } {
      return db.transaction(() => {
        const target = revision(id);
        if (target === undefined) {
          throw new StateError('not_found', '这次改动不在了。');
        }
        if (target.actor === 'system' || target.undoneAt !== null || target.undoes !== null) {
          throw new StateError('invalid_input', '这次改动撤不了。');
        }
        const current = get(target.owner);
        if (current === undefined || current.text !== target.after) {
          throw new StateError('version_conflict', '之后又改过，撤不了这一次；可以直接改成你要的样子。');
        }
        const result = write(target.owner, current.version, target.before, 'user', note, target.id);
        db.run('UPDATE soul_revisions SET undone_at = $at WHERE id = $id', { id, at: context.now() });
        return result;
      });
    },
  };
}

export type SoulStore = ReturnType<typeof createSoulStore>;
