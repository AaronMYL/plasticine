// 假的技能：目录、读正文、删；11-13 加商店清单、装之前先看、装、让 Plasticine 写草稿、存自己写的（技能页的「添加」「新建」）。

import type { SkillsApi, SkillListQuery, SkillReadQuery } from '../capabilities-client.ts';
import type { CreateSkillRequest, DraftSkillRequest, InstallSkillRequest, RemoveSkillResponse, SkillDescriptor,
  SkillDraft, SkillListResponse, SkillOrigin, SkillPreview, SkillResponse, SkillRow, SkillSavedResponse,
  SkillStoreResponse, StoreSkillView } from '../shared.ts';
import type { FakeSession } from './fake-session.ts';
import { ApiError } from '../errors.ts';

interface Stored { descriptor: SkillDescriptor; title: string | null; text: string; uses: number }

const STORE: ReadonlyArray<Omit<StoreSkillView, 'installed'> & { text: string }> = [
  { name: 'meeting-notes', title: '会议纪要', description: '把会议录音的转写整理成纪要：结论、待办、没定的问题',
    category: '办公', source: 'official', updatedAt: '2026-11-13', files: ['SKILL.md'], scripts: false,
    text: '1. 先通读转写，标出每个议题从哪句开始。\n2. 每个议题写：结论一句、谁负责、什么时候。\n'
      + '3. 没定下来的单独列成「没定的问题」。\n4. 纪要先给他看，他说行再存成笔记。' },
  { name: 'paper-reading', title: '读论文', description: '读一篇论文：问题、方法、结论、局限，判断值不值得细看',
    category: '研究', source: 'official', updatedAt: '2026-11-13', files: ['SKILL.md'], scripts: false,
    text: '1. 先确认读到的是全文还是摘要。\n2. 写五节：问题、方法、结论、局限、和他的关系。' },
  { name: 'resume-fit', title: '对着岗位改简历', description: '拿岗位要求逐条对简历：有什么、缺什么、怎么改',
    category: '写作', source: 'official', updatedAt: '2026-11-13', files: ['SKILL.md'], scripts: false,
    text: '1. 把岗位要求拆成一条一条。\n2. 逐条对简历。' },
  { name: 'sheet-cleanup', title: '表格清洗', description: '表头错位、重复行、格式不一的表格整理干净',
    category: '办公', source: 'community', updatedAt: '2026-11-10', files: ['SKILL.md', 'scripts/clean.py'],
    scripts: true, text: '1. 先看不改。\n2. 在副本上改，原表留着。' },
  { name: 'trip-plan', title: '旅行计划', description: '按天排行程：交通、住处、每天走多少路',
    category: '生活', source: 'community', updatedAt: '2026-11-09', files: ['SKILL.md'], scripts: false,
    text: '1. 先问清哪几天、几个人。\n2. 按天排。' },
  { name: 'weekly-review', title: '每周复盘', description: '把这一周做完的、卡住的、下周要做的理出来',
    category: '办公', source: 'official', updatedAt: '2026-11-13', files: ['SKILL.md'], scripts: false,
    text: '1. 先收材料。\n2. 做完的、卡住的、下周的各一节。' },
];

function document(name: string, title: string | null, description: string, body: string): string {
  const head = title === null ? '' : `title: ${JSON.stringify(title)}\n`;
  return `---\nname: ${name}\n${head}description: ${JSON.stringify(description)}\n---\n\n${body}\n`;
}

function notFound(message: string): ApiError {
  return new ApiError({ kind: 'not_found', code: 'not_found', message, status: 404 });
}

function invalid(message: string): ApiError {
  return new ApiError({ kind: 'invalid', code: 'invalid_request', message, status: 400 });
}

export class FakeSkills implements SkillsApi {
  private readonly session: FakeSession;
  private readonly rows = new Map<string, Stored>();
  /** 测试：商店连不上时回的那句（null = 连得上）。 */
  storeDown: string | null = null;
  /** 测试：下一次写草稿回什么（null = 照他说的编一份）。 */
  nextDraft: SkillDraft | null = null;
  constructor(session: FakeSession) { this.session = session; }

  seed(description: string, text: string): void {
    this.put('research-notes', null, description, text, 'agent', 'Plasticine', ['references/example.md'], 3);
  }

  /** 场景种子：随应用的两个，加一个 Plasticine 整理的。 */
  seedPage(): void {
    this.put('plasticine-guide', 'Plasticine 怎么用', 'Plasticine 怎么用：各栏目在哪、能做什么、常见问题怎么解决',
      '## 方法\n\n1. 先弄清他问的是哪个栏目里的事，再回答。\n2. 回答先给结论：去哪里点、点了会怎样。\n'
      + '3. 功能还没有的，直接说没有，不编。\n\n## 目录\n\n首页 · Plasticine · 消息 · 任务 · 网页 · 阅读 · 笔记 · 资料库 · 设置',
      'builtin', 'builtin', [], 12);
    this.put('video-parse', '视频解析', '解析抖音等视频：转写、提要点、写成报告',
      '1. 先拿到视频的转写。\n2. 提要点。\n3. 写成报告。', 'builtin', 'builtin', ['prompts/outline.md'], 31);
    this.put('weekly-digest', '周报整理', '把一周的信息流整理成周报：先核实来源，再按主题归并',
      '1. 先核实来源。\n2. 按主题归并。', 'agent', 'Plasticine', [], 4);
  }

  private put(name: string, title: string | null, description: string, body: string,
    kind: SkillDescriptor['source']['kind'], origin: string, resources: string[] = [], uses = 0): Stored {
    const descriptor: SkillDescriptor = { name, description, version: 'a'.repeat(64),
      source: { kind, origin, runId: null, taskId: null, actionId: null, recordedAt: '2026-11-01T00:00:00.000Z' },
      directory: `skills/${name}`, resources: ['SKILL.md', ...resources] };
    const stored = { descriptor, title, text: kind === 'agent' && title === null ? body
      : document(name, title, description, body), uses };
    this.rows.set(name, stored);
    return stored;
  }

  private row(stored: Stored): SkillRow {
    return { ...stored.descriptor, uses: stored.uses,
      lastUsedAt: stored.uses === 0 ? null : '2026-11-04T09:00:00.000Z', title: stored.title };
  }

  async list(query: SkillListQuery): Promise<SkillListResponse> {
    this.session.require();
    const all = [...this.rows.values()].map((stored) => this.row(stored))
      .filter((row) => `${row.name} ${row.title ?? ''} ${row.description}`.includes(query.query ?? ''))
      .sort((a, b) => a.name.localeCompare(b.name));
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

  async store(): Promise<SkillStoreResponse> {
    this.session.require();
    if (this.storeDown !== null) {
      throw new ApiError({ kind: 'failed', code: 'upstream_failed', status: 502, message: this.storeDown });
    }
    return { skills: STORE.map(({ text: _text, ...skill }) => ({ ...skill, installed: this.rows.has(skill.name) })) };
  }

  private bundle(from: SkillOrigin): { name: string; title: string | null; description: string; text: string;
    files: string[]; scripts: boolean; origin: string } {
    if (from.kind === 'store') {
      const entry = STORE.find((skill) => skill.name === from.name);
      if (entry === undefined) throw notFound('商店里没有这个技能了。');
      return { name: entry.name, title: entry.title, description: entry.description, files: [...entry.files],
        scripts: entry.scripts, text: document(entry.name, entry.title, entry.description, entry.text),
        origin: `store:${entry.name}` };
    }
    if (from.kind === 'url') {
      if (!/\/SKILL\.md$|\/tree\//.test(from.url)) {
        throw invalid('网址要指到 GitHub 上的一个技能目录（…/tree/…），或者直接指到一份 SKILL.md。');
      }
      const name = /\/([a-z0-9-]+)(?:\/SKILL\.md)?\/?$/.exec(from.url)?.[1] ?? 'from-url';
      return { name, title: null, description: '从网址装的技能', files: ['SKILL.md'], scripts: false,
        text: document(name, null, '从网址装的技能', '1. 照这份方法做。'), origin: `url:${from.url}` };
    }
    const head = from.files.find((file) => /(^|\/)SKILL\.md$/.test(file.path));
    if (head === undefined) throw invalid('这里面没有 SKILL.md，不是一个技能。');
    const name = /^name:\s*(\S+)\s*$/m.exec(head.content)?.[1] ?? '';
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
      throw invalid('SKILL.md 开头要写 name（小写字母、数字、连字符）和 description。');
    }
    const prefix = head.path.slice(0, head.path.length - 'SKILL.md'.length);
    const files = from.files.filter((file) => file.path.startsWith(prefix))
      .map((file) => file.path.slice(prefix.length));
    return { name, title: /^title:\s*"?([^"\n]+)"?\s*$/m.exec(head.content)?.[1] ?? null,
      description: /^description:\s*"?([^"\n]+)"?\s*$/m.exec(head.content)?.[1] ?? '', files,
      scripts: files.some((path) => /\.(?:sh|py|js)$/.test(path)), text: head.content, origin: 'files' };
  }

  async preview(from: SkillOrigin): Promise<SkillPreview> {
    this.session.require();
    const { origin: _origin, ...bundle } = this.bundle(from);
    return { ...bundle, installed: this.rows.has(bundle.name) };
  }

  private save(name: string, title: string | null, description: string, text: string, origin: string,
    files: string[], replace: boolean): SkillSavedResponse {
    const existing = this.rows.get(name);
    if (existing?.descriptor.source.kind === 'builtin') {
      throw new ApiError({ kind: 'failed', code: 'conflict', status: 409, message: '和随应用提供的技能重名了，换一个短名。' });
    }
    if (existing !== undefined && !replace) {
      throw new ApiError({ kind: 'failed', code: 'conflict', status: 409, message: '已经有同名的技能了。' });
    }
    const stored = this.put(name, title, description, '', 'installed', origin,
      files.filter((path) => path !== 'SKILL.md'));
    stored.text = text;
    return { skill: this.row(stored) };
  }

  async install(input: InstallSkillRequest): Promise<SkillSavedResponse> {
    this.session.require();
    const bundle = this.bundle(input.from);
    return this.save(bundle.name, bundle.title, bundle.description, bundle.text, bundle.origin, bundle.files,
      input.replace === true);
  }

  async draft(input: DraftSkillRequest): Promise<SkillDraft> {
    this.session.require();
    const said = input.said?.trim() ?? '';
    if (said === '' && input.lineId === undefined) throw invalid('先说一句想让 Plasticine 学会什么，或者挑一件做成过的事。');
    if (this.nextDraft !== null) {
      const draft = this.nextDraft;
      this.nextDraft = null;
      return draft;
    }
    return { title: '会议纪要', name: 'meeting-notes', description: '收到会议录音的转写或会议记录，要整理成纪要的时候',
      body: '1. 先通读转写，标出每个议题从哪句开始。\n2. 每个议题写：结论一句、谁负责、什么时候。\n'
        + '3. 没定下来的单独列成「没定的问题」。\n4. 纪要先给他看，他说行再存成笔记。' };
  }

  async create(input: CreateSkillRequest): Promise<SkillSavedResponse> {
    this.session.require();
    return this.save(input.name, input.title.trim() === '' ? null : input.title.trim(), input.description,
      document(input.name, input.title.trim() === '' ? null : input.title.trim(), input.description, input.body),
      'user', ['SKILL.md'], false);
  }
}
