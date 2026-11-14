// 假的 Soul 和规则搬家（第13批，和服务端 agent/src/mates/souls.ts、brain/rules-move.ts 同一套规矩）：主线和每位队友
// 各一份，改一次记一条（谁改的、改了几处），撤回只撤之后没再改过的那一次；规则搬家按同样的建议分、勾了才搬。

import { ApiError } from '../errors.ts';
import type { SoulsApi } from '../souls-client.ts';
import { appendToSection, diffSoul, MAIN_SOUL_OPENING, mateSoulOpening, SOUL_OWNER_MAIN, soulChangeCount }
  from '../shared.ts';
import type { ApplyRulesMoveRequest, ApplyRulesMoveResponse, MateView, RulesMoveItem, RulesMoveResponse,
  SoulActor, SoulLine, SoulResponse, SoulRevision, SoulRevisionDiffResponse, UndoSoulRequest, UpdateSoulRequest }
  from '../shared.ts';
import type { FakeSession } from './fake-session.ts';
import type { FakeSoul } from './fake-soul.ts';
import type { FakeReceipts } from './receipts.ts';

interface Revision { id: string; actor: SoulActor; note: string; at: string; before: string; after: string;
  undoneAt: string | null; undoes: string | null }

interface Deps {
  session: FakeSession;
  receipts: FakeReceipts;
  now: () => Date;
  mainName: () => string;
  mates: () => readonly MateView[];
  rules: FakeSoul;
  /** 进「关于你」的一行。 */
  aboutYou: (text: string) => void;
}

const missing = (): ApiError => new ApiError({ kind: 'not_found', status: 404, code: 'not_found',
  message: '找不到这位的 Soul。' });
const conflict = (message: string): ApiError => new ApiError({ kind: 'conflict', status: 409,
  code: 'version_conflict', message });

export class FakeSouls implements SoulsApi {
  private readonly rows = new Map<string, { text: string; version: number; updatedAt: string }>();
  private readonly history = new Map<string, Revision[]>();
  private serial = 0;
  private readonly deps: Deps;
  constructor(deps: Deps) { this.deps = deps; }

  /** 没有就照起步的样子建（主线那一段、队友「你是我的……」）。 */
  ensure(owner: string, text?: string): void {
    if (this.rows.has(owner)) return;
    const mate = this.deps.mates().find((row) => row.id === owner);
    const body = text ?? (owner === SOUL_OWNER_MAIN ? MAIN_SOUL_OPENING
      : mate === undefined ? undefined : mateSoulOpening(mate.name, mate.role));
    if (body === undefined) throw missing();
    this.rows.set(owner, { text: body, version: 1, updatedAt: this.deps.now().toISOString() });
    this.record(owner, 'system', '', body, '起步');
  }

  /** 测试用：现在的字；还没有这一份是 null。 */
  textOf(owner: string): string | null {
    return this.rows.get(owner)?.text ?? null;
  }

  /** 截图和测试用：夜里自己改了一次（at 不给就是现在）。 */
  seedSelf(owner: string, text: string, note: string, at?: Date): void {
    this.ensure(owner);
    this.write(owner, text, 'self', note);
    const latest = this.history.get(owner)?.[0];
    if (at !== undefined && latest !== undefined && latest.actor === 'self') latest.at = at.toISOString();
  }

  private record(owner: string, actor: SoulActor, before: string, after: string, note: string,
    undoes: string | null = null): Revision {
    const revision = { id: `soul-rev-${++this.serial}`, actor, note, at: this.deps.now().toISOString(), before, after,
      undoneAt: null, undoes };
    this.history.set(owner, [revision, ...this.history.get(owner) ?? []]);
    return revision;
  }

  private write(owner: string, text: string, actor: SoulActor, note: string, undoes: string | null = null): void {
    const row = this.rows.get(owner)!;
    const body = text.replace(/\s+$/u, '');
    if (body === row.text) return;
    this.rows.set(owner, { text: body, version: row.version + 1, updatedAt: this.deps.now().toISOString() });
    this.record(owner, actor, row.text, body, note, undoes);
  }

  private view(owner: string): SoulResponse {
    const row = this.rows.get(owner)!;
    const revisions: SoulRevision[] = (this.history.get(owner) ?? []).slice(0, 20).map((item) => ({ id: item.id,
      actor: item.actor, note: item.note, at: item.at, changes: soulChangeCount(item.before, item.after),
      undoneAt: item.undoneAt, undoes: item.undoes }));
    return structuredClone({ soul: { owner, text: row.text, version: row.version, updatedAt: row.updatedAt },
      revisions });
  }

  async get(owner: string): Promise<SoulResponse> {
    this.deps.session.require();
    this.ensure(owner);
    return this.view(owner);
  }

  async update(owner: string, input: UpdateSoulRequest): Promise<SoulResponse> {
    this.deps.session.requireUser();
    return this.deps.receipts.run('save', input.requestId, `souls:${owner}:${input.version}:${input.text}`, () => {
      this.ensure(owner);
      if (this.rows.get(owner)!.version !== input.version) throw conflict('Soul 刚刚改过，请看一眼现在的再改。');
      this.write(owner, input.text, 'user', '你改的');
      return this.view(owner);
    });
  }

  async undo(owner: string, input: UndoSoulRequest): Promise<SoulResponse> {
    this.deps.session.requireUser();
    return this.deps.receipts.run('save', input.requestId, `souls-undo:${input.revisionId}`, () => {
      const target = (this.history.get(owner) ?? []).find((item) => item.id === input.revisionId);
      if (target === undefined) throw missing();
      if (target.actor === 'system' || target.undoneAt !== null || target.undoes !== null) {
        throw new ApiError({ kind: 'invalid', status: 400, code: 'invalid_request', message: '这次改动撤不了。' });
      }
      if (this.rows.get(owner)?.text !== target.after) {
        throw conflict('之后又改过，撤不了这一次；可以直接改成你要的样子。');
      }
      this.write(owner, target.before, 'user', '撤回了一次改动', target.id);
      target.undoneAt = this.deps.now().toISOString();
      return this.view(owner);
    });
  }

  async revision(owner: string, id: string): Promise<SoulRevisionDiffResponse> {
    this.deps.session.require();
    const target = (this.history.get(owner) ?? []).find((item) => item.id === id);
    if (target === undefined) throw missing();
    const revision = this.view(owner).revisions.find((item) => item.id === id) ?? { id, actor: target.actor,
      note: target.note, at: target.at, changes: soulChangeCount(target.before, target.after),
      undoneAt: target.undoneAt, undoes: target.undoes };
    return { revision, diff: diffSoul(target.before, target.after) };
  }

  private suggestion(line: SoulLine): Pick<RulesMoveItem, 'dest' | 'suggested'> {
    if (line.scopeKind === 'mate' && line.scopeRef !== null) {
      return { dest: { kind: 'soul', owner: line.scopeRef }, suggested: true };
    }
    if (line.source === 'user' || line.source === 'conversation') {
      return { dest: { kind: 'about_you', owner: null }, suggested: true };
    }
    if (line.source === 'system' && line.section === 'outbound') {
      return { dest: { kind: 'product', owner: null }, suggested: false };
    }
    return { dest: { kind: 'soul', owner: SOUL_OWNER_MAIN }, suggested: true };
  }

  async rulesMove(): Promise<RulesMoveResponse> {
    this.deps.session.require();
    return { items: this.deps.rules.live().map((line) => ({ id: line.id, version: line.version, text: line.text,
      moved: line.text.replaceAll('用户', '我'), section: line.section, source: line.source,
      ...this.suggestion(line) })),
    owners: [{ owner: SOUL_OWNER_MAIN, name: this.deps.mainName() }, ...this.deps.mates().map((mate) => ({
      owner: mate.id, name: mate.disabledAt === null ? mate.name : `${mate.name}（已停用）` }))] };
  }

  async applyRulesMove(input: ApplyRulesMoveRequest): Promise<ApplyRulesMoveResponse> {
    this.deps.session.requireUser();
    return this.deps.receipts.run('save', input.requestId, `rules-move:${JSON.stringify(input.moves)}`, () => {
      const lines = this.deps.rules.take(input.moves);
      const souls = new Map<string, string[][]>();
      lines.forEach((line, index) => {
        const dest = input.moves[index]!.dest;
        if (dest.kind === 'soul') {
          const owner = dest.owner ?? SOUL_OWNER_MAIN;
          const heading = line.section === 'speaking' ? '说话' : '和我相处中形成的判断';
          souls.set(owner, [...souls.get(owner) ?? [], [heading, line.text.replaceAll('用户', '我')]]);
        } else if (dest.kind === 'about_you') {
          this.deps.aboutYou(line.text);
        }
      });
      for (const [owner, entries] of souls) {
        this.ensure(owner);
        const text = entries.reduce((current, [heading = '', line = '']) => appendToSection(current, heading, line),
          this.rows.get(owner)!.text);
        this.write(owner, text, 'move', `规则搬家：搬进来 ${String(entries.length)} 条`);
      }
      return { moved: lines.length, remaining: this.deps.rules.live().length };
    });
  }
}
