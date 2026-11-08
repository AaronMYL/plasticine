import type { SkillsApi, SkillListQuery, SkillReadQuery } from '../capabilities-client.ts';
import type { RemoveSkillResponse, SkillDescriptor, SkillListResponse, SkillResponse } from '../shared.ts';
import type { FakeSession } from './fake-session.ts';
import { ApiError } from '../errors.ts';

export class FakeSkills implements SkillsApi {
  private readonly session: FakeSession;
  private readonly rows = new Map<string, { descriptor: SkillDescriptor; text: string }>();
  constructor(session: FakeSession) { this.session = session; }
  seed(description: string, text: string): void {
    const descriptor: SkillDescriptor = { name: 'research-notes', description, version: 'a'.repeat(64),
      source: { kind: 'agent', origin: 'Plasticine', runId: null, taskId: null, actionId: null,
        recordedAt: '2026-11-01T00:00:00.000Z' }, directory: 'skills/research-notes',
      resources: ['SKILL.md', 'references/example.md'] };
    this.rows.set(descriptor.name, { descriptor, text });
  }
  async list(query: SkillListQuery): Promise<SkillListResponse> {
    this.session.require();
    const all = [...this.rows.values()].map((row) => ({ ...row.descriptor, uses: 3,
      lastUsedAt: '2026-11-04T09:00:00.000Z' }))
      .filter((row) => `${row.name} ${row.description}`.includes(query.query ?? ''));
    const offset = query.offset ?? 0;
    const end = offset + (query.limit ?? 20);
    return { skills: all.slice(offset, end), total: all.length, nextOffset: end < all.length ? end : null, issues: [] };
  }
  async read(name: string, query: SkillReadQuery): Promise<SkillResponse> {
    this.session.require();
    const row = this.rows.get(name);
    if (row === undefined) {
      throw new ApiError({ kind: 'not_found', code: 'not_found', message: '这份技能不存在。', next: '刷新目录后再看。' });
    }
    const path = query.path ?? 'SKILL.md';
    const text = path === 'SKILL.md' ? row.text : '参考内容';
    return { skill: { ...row.descriptor, path, text, offset: query.offset ?? 0, nextOffset: null,
      totalChars: text.length, instructionAuthority: 'method', note: '查看方法不会启动任务。' } };
  }
  async remove(name: string): Promise<RemoveSkillResponse> {
    this.session.require();
    const row = this.rows.get(name);
    if (row === undefined) {
      throw new ApiError({ kind: 'not_found', code: 'not_found', message: '这份技能不存在。' });
    }
    if (row.descriptor.source.kind === 'builtin') {
      throw new ApiError({ kind: 'failed', code: 'conflict', status: 409, message: '内置技能随程序发，删不了。' });
    }
    this.rows.delete(name);
    return { name };
  }
}
