// 设备动作的回执接续（和 Mac 壳 action-journal.swift 同一条）：动作开始前原子记一笔「在做」，做完原子记结果，结果上传
// 失败只重传原结果；同一个动作 id 只执行一次。壳在执行中被强制结束的，下次启动报「结果待核实」，不再跑一遍。
// 记录在 actions/<本体源地址的 SHA-256>/<节点 id>/<动作 id>.json，不含节点凭证。上传成功后只留 id 和状态（去重够用），
// 结果正文（可能是整张截图）不再留着。

import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import { NodeActionResultRequestSchema, type NodeActionResultRequest } from '../../../agent/shared/api/index.ts';

const EntrySchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  kind: Type.String(),
  startedAt: Type.String(),
  state: Type.Enum(['running', 'done', 'uploaded']),
  result: Type.Union([NodeActionResultRequestSchema, Type.Null()]),
}, { additionalProperties: false });
type Entry = Static<typeof EntrySchema>;

/** 中途被打断的动作交回去的结果。 */
export const INTERRUPTED: NodeActionResultRequest = {
  status: 'failed',
  error: '这台电脑上的 Plasticine 在做这一步时被关掉了，结果待核实；没有再做一遍。',
};

const SAFE_ID = /^[A-Za-z0-9_.:-]{1,200}$/;

export class InvalidActionId extends Error {}

export class ActionJournal {
  private readonly directory: string;
  private readonly now: () => Date;

  constructor(root: string, server: string, nodeId: string, now: () => Date = () => new Date()) {
    const serverKey = createHash('sha256').update(server).digest('hex');
    this.directory = join(root, serverKey, nodeId.replace(/[^A-Za-z0-9_-]/g, '_'));
    this.now = now;
  }

  /** 这个动作 id 见过没有（见过就不再执行）。 */
  seen(id: string): boolean {
    return this.read(id) !== null;
  }

  begin(id: string, kind: string): void {
    this.write({ id, kind, startedAt: this.now().toISOString(), state: 'running', result: null });
  }

  finish(id: string, result: NodeActionResultRequest): void {
    const entry = this.read(id);
    if (entry === null) {
      throw new Error(`回执记录里没有动作 ${id}，先 begin。`);
    }
    this.write({ ...entry, state: 'done', result });
  }

  uploaded(id: string): void {
    const entry = this.read(id);
    if (entry !== null) {
      this.write({ ...entry, state: 'uploaded', result: null });
    }
  }

  /** 还没交上去的结果（含中途被打断的，记成待核实）。启动时和每轮领活前先交这些。 */
  unsent(): { id: string; result: NodeActionResultRequest }[] {
    const unsent: { id: string; result: NodeActionResultRequest }[] = [];
    for (const name of this.names()) {
      const entry = this.read(name.slice(0, -'.json'.length));
      if (entry === null || entry.state === 'uploaded') {
        continue;
      }
      if (entry.state === 'running') {
        this.write({ ...entry, state: 'done', result: INTERRUPTED });
        unsent.push({ id: entry.id, result: INTERRUPTED });
      } else if (entry.result !== null) {
        unsent.push({ id: entry.id, result: entry.result });
      }
    }
    return unsent;
  }

  private names(): string[] {
    try {
      return readdirSync(this.directory).filter((name) => name.endsWith('.json'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  private file(id: string): string {
    if (!SAFE_ID.test(id)) {
      throw new InvalidActionId('动作 id 里有不能当文件名的字符。');
    }
    return join(this.directory, `${id}.json`);
  }

  private read(id: string): Entry | null {
    let text: string;
    try {
      text = readFileSync(this.file(id), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
    const raw: unknown = JSON.parse(text);
    if (!Value.Check(EntrySchema, raw)) {
      throw new Error(`动作 ${id} 的回执记录形状不对。`);
    }
    return raw;
  }

  private write(entry: Entry): void {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const file = this.file(entry.id);
    const temporary = `${file}.partial`;
    writeFileSync(temporary, JSON.stringify(entry), { mode: 0o600 });
    renameSync(temporary, file);
  }
}
