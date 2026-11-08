import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { Value } from 'typebox/value';
import { ServerCommandRecordSchema, ServerCommandRequestSchema,
  type ServerCommandRecord, type ServerCommandRequest } from '../../shared/server-command.ts';
import { runServerProcess } from './server-process.ts';

interface CommandIdentity { actionId: string; runId: string; taskId: string | null }
interface ServerCommandsOptions { stateDirectory: string; cwd?: string; now?: () => Date }
export type ServerCommandResult = ServerCommandRecord & { reused: boolean };
export interface ServerCommandPage {
  command: ServerCommandRecord;
  stream: 'stdout' | 'stderr' | 'script';
  text: string;
  offset: number;
  nextOffset: number | null;
  totalChars: number;
}
const digest = (text: string): string => createHash('sha256').update(text).digest('hex');
const unfinished = (row: ServerCommandRecord): boolean => ['claimed', 'running', 'unknown'].includes(row.status);

/** Durable per-action execution journal complements, never replaces, the Harness receipt. */
export class ServerCommands {
  readonly #root: string;
  readonly #cwd: string;
  readonly #now: () => Date;
  readonly #active = new Set<string>();

  constructor(options: ServerCommandsOptions) {
    this.#root = join(options.stateDirectory, 'server-commands');
    // 默认从应用账号的家目录跑：进程的工作目录是程序的安装目录，不是 Plasticine 干活的地方（《优化清单》第 1 条）。
    this.#cwd = resolve(options.cwd ?? homedir());
    this.#now = options.now ?? (() => new Date());
    mkdirSync(this.#root, { recursive: true, mode: 0o700 });
  }

  async execute(input: ServerCommandRequest, identity: CommandIdentity,
    signal: AbortSignal): Promise<ServerCommandResult> {
    if (!Value.Check(ServerCommandRequestSchema, input) || input.script.trim() === '' || input.script.includes('\0')) {
      throw new Error('命令格式不对，script 不能为空或含 NUL。');
    }
    if (signal.aborted) { throw new Error('执行前已取消，没有运行命令。'); }
    if (identity.actionId === '') { throw new Error('服务器命令必须使用 Harness 的稳定动作标识。'); }
    const cwd = input.cwd ?? this.#cwd;
    if (!isAbsolute(cwd) || cwd.includes('\0')) { throw new Error('cwd 要使用服务器上的绝对路径。'); }
    const request = { script: input.script, cwd: resolve(cwd), timeoutMs: input.timeoutMs ?? 120_000 };
    const id = digest(identity.actionId);
    const directory = join(this.#root, id);
    const row: ServerCommandRecord = { ...identity, ...request, id, requestHash: digest(JSON.stringify(request)),
      status: 'claimed', pid: null, startedAt: this.#now().toISOString(), finishedAt: null, exitCode: null,
      signal: null, stdoutBytes: 0, stderrBytes: 0, error: null };
    try { mkdirSync(directory, { mode: 0o700 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') { throw error; }
      const previous = this.#record(id);
      if (previous === undefined) {
        return { ...row, status: 'unknown', error: '动作目录已存在但记录不完整，不能判断有没有执行；先核实。', reused: true };
      }
      if (previous.requestHash !== row.requestHash) { throw new Error('同一动作标识收到不同的命令，未重新执行。'); }
      return { ...previous, reused: true };
    }
    this.#save(row);
    this.#active.add(id);
    try {
      const result = await runServerProcess(row, directory, signal, (pid) => {
        row.pid = pid;
        row.status = 'running';
        this.#save(row);
      });
      Object.assign(row, result, { finishedAt: this.#now().toISOString() });
      this.#save(row);
      return { ...row, reused: false };
    } catch (error) {
      row.status = 'unknown';
      row.error = error instanceof Error ? error.message : String(error);
      row.finishedAt = this.#now().toISOString();
      this.#save(row);
      return { ...row, reused: false };
    } finally { this.#active.delete(id); }
  }

  list(taskId?: string): ServerCommandRecord[] {
    return readdirSync(this.#root).filter((id) => /^[a-f0-9]{64}$/.test(id))
      .map((id) => this.#record(id)).filter((row): row is ServerCommandRecord => row !== undefined)
      .filter((row) => taskId === undefined || row.taskId === taskId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 50);
  }

  read(id: string, stream: 'stdout' | 'stderr' | 'script' = 'stdout', offset = 0, limit = 4_000): ServerCommandPage {
    const command = this.#record(id);
    if (command === undefined) { throw new Error('找不到这条服务器命令的执行记录。'); }
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 8_000) {
      throw new Error('输出页 offset 要是非负整数，limit 要在 1–8000 之间。');
    }
    const path = join(this.#root, id, stream);
    const data = stream === 'script' ? command.script : existsSync(path) ? readFileSync(path, 'utf8') : '';
    let count = 0;
    let text = '';
    for (const char of data) {
      if (count >= offset && count < offset + limit) { text += char; }
      count += 1;
    }
    return { command, stream, text, offset, nextOffset: offset + limit < count ? offset + limit : null,
      totalChars: count };
  }

  verify(actionId: string): { outcome: 'happened' | 'not_happened' | 'unknown'; basis: string; result?: string } {
    const row = this.#record(digest(actionId));
    if (row === undefined || unfinished(row)) {
      return { outcome: 'unknown', basis: row === undefined ? '没有找到服务器命令落盘记录。'
        : `服务器命令 ${row.id} 状态 ${row.status}，需读取输出并核实实际影响；没有重新发出。` };
    }
    return { outcome: row.status === 'start_failed' ? 'not_happened' : 'happened',
      basis: `服务器命令落盘结果：${row.status}，退出码 ${row.exitCode ?? '无'}。`
        + '命令执行结果已知；业务目标是否完成仍要依据输出核实。', result: JSON.stringify(row) };
  }

  #record(id: string): ServerCommandRecord | undefined {
    if (!/^[a-f0-9]{64}$/.test(id)) { throw new Error('命令编号格式不对。'); }
    const path = join(this.#root, id, 'command.json');
    if (!existsSync(path)) { return undefined; }
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!Value.Check(ServerCommandRecordSchema, value) || value.id !== id) { throw new Error('命令记录损坏。'); }
    for (const stream of ['stdout', 'stderr'] as const) {
      const output = join(this.#root, id, stream);
      if (existsSync(output)) { value[`${stream}Bytes`] = statSync(output).size; }
    }
    if (unfinished(value) && !this.#active.has(id)) { value.status = 'unknown'; }
    return value;
  }

  #save(row: ServerCommandRecord): void {
    const path = join(this.#root, row.id, 'command.json');
    const temporary = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(row)}\n`, { mode: 0o600, flush: true });
    renameSync(temporary, path);
  }
}
