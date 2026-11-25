import { readFileSync, realpathSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  MAIL_REFETCH_MAX_LIMIT,
  MAINTENANCE_COMMAND_PATH,
  MAINTENANCE_OPS,
  MAINTENANCE_SOCKET_FILE,
  type MaintenanceOp,
  type MaintenanceRequest,
} from '../agent/shared/api/maintenance.ts';

const DEFAULT_STATE = '/home/plasticine/state/agent';
const DATABASE_FILE = 'plasticine.sqlite';
const READ_STATEMENT = /^\s*(SELECT|WITH|PRAGMA|EXPLAIN)\b/i;

export class MaintCliError extends Error {}

export interface ParsedCommand {
  kind: 'socket' | 'db.read';
  stateDir: string;
  request?: MaintenanceRequest;
  sql?: string;
}

function isOp(value: string): value is MaintenanceOp {
  return (MAINTENANCE_OPS as readonly string[]).includes(value);
}

function newOperationId(now: Date): string {
  return `maint-${now.toISOString().replace(/[^0-9]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`;
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new MaintCliError(`--plan 读不成：${error instanceof Error ? error.message : String(error)}`);
  }
}

function readPlan(path: string): NonNullable<MaintenanceRequest['plan']> {
  const value = readJson(path);
  if (!Array.isArray(value)) throw new MaintCliError('--plan 要是一个 JSON 数组。');
  return value as NonNullable<MaintenanceRequest['plan']>;
}

function readLayersPlan(path: string): Pick<MaintenanceRequest, 'moves'> {
  const value = readJson(path) as { moves?: unknown } | null;
  if (!Array.isArray(value?.moves) || value.moves.length === 0) {
    throw new MaintCliError('--plan 要是 {"moves":[…]}，至少一行。');
  }
  return { moves: value.moves as NonNullable<MaintenanceRequest['moves']> };
}

function readLinePlan(path: string): Pick<MaintenanceRequest, 'line'> {
  const value = readJson(path) as { title?: unknown; goal?: unknown } | null;
  if (typeof value?.title !== 'string' || typeof value.goal !== 'string') {
    throw new MaintCliError('--plan 要是 {"title":"…","goal":"…"}。');
  }
  return { line: { title: value.title, goal: value.goal } };
}

function planField(command: string, plan: NonNullable<MaintenanceRequest['plan']>): Partial<MaintenanceRequest> {
  if (command === 'memory.move') {
    return { moves: plan as unknown as NonNullable<MaintenanceRequest['moves']> };
  }
  if (command === 'memory.cleanup.add') {
    return { adds: plan as unknown as NonNullable<MaintenanceRequest['adds']> };
  }
  return { plan };
}

function planOf(command: MaintenanceOp, path: string): Partial<MaintenanceRequest> {
  if (command === 'memory.layers') {
    return readLayersPlan(path);
  }
  return command === 'line.start' ? readLinePlan(path) : planField(command, readPlan(path));
}

export function parseMaintArgs(argv: readonly string[], env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date()): ParsedCommand {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      because: { type: 'string' },
      'op-id': { type: 'string' },
      state: { type: 'string' },
      limit: { type: 'string' },
      plan: { type: 'string' },
      ids: { type: 'string' },
      sources: { type: 'string' },
    },
  });
  const stateDir = values.state ?? env['PLASTICINE_STATE'] ?? DEFAULT_STATE;
  const [command, ...rest] = positionals;
  if (command === 'db.read') {
    const sql = rest.join(' ');
    if (!READ_STATEMENT.test(sql)) {
      throw new MaintCliError('db.read 只收 SELECT / WITH / PRAGMA / EXPLAIN 开头的一句。');
    }
    return { kind: 'db.read', stateDir, sql };
  }
  if (command === undefined || !isOp(command)) {
    throw new MaintCliError(`不认识的命令「${command ?? ''}」。可用：${MAINTENANCE_OPS.join('、')}、db.read。`);
  }
  const limit = values.limit === undefined ? undefined : Number(values.limit);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > MAIL_REFETCH_MAX_LIMIT)) {
    throw new MaintCliError(`--limit 要是 1 到 ${MAIL_REFETCH_MAX_LIMIT} 的整数。`);
  }
  const request: MaintenanceRequest = {
    operationId: values['op-id'] ?? newOperationId(now),
    op: command,
    ...(values.because === undefined ? {} : { because: values.because }),
    ...(limit === undefined ? {} : { limit }),
    ...(values.sources === undefined ? {} : { sources: values.sources.split(',').map((source) => source.trim())
      .filter((source) => source !== '') as NonNullable<MaintenanceRequest['sources']> }),
    ...(values.ids === undefined ? {}
      : { ids: values.ids.split(',').map((id) => id.trim()).filter((id) => id !== '') }),
    ...(values.plan === undefined ? {} : planOf(command, values.plan)),
  };
  return { kind: 'socket', stateDir, request };
}

export function readDatabase(stateDir: string, sql: string): unknown[] {
  if (!READ_STATEMENT.test(sql)) {
    throw new MaintCliError('db.read 只收 SELECT / WITH / PRAGMA / EXPLAIN 开头的一句。');
  }
  const db = new DatabaseSync(join(stateDir, DATABASE_FILE), { readOnly: true });
  try {
    return db.prepare(sql).all();
  } finally {
    db.close();
  }
}

export function sendMaintenance(socketPath: string,
  body: MaintenanceRequest): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, path: MAINTENANCE_COMMAND_PATH, method: 'POST',
      headers: { 'content-type': 'application/json' } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try {
          resolve({ status: res.statusCode ?? 0, json: JSON.parse(text) as unknown });
        } catch (error) {
          const what = error instanceof Error ? error.message : String(error);
          reject(new MaintCliError(`服务的回答不是 JSON（HTTP ${String(res.statusCode)}，${what}）：${text.slice(0, 200)}`));
        }
      });
    });
    req.on('error', (error: NodeJS.ErrnoException) => {
      const hint = error.code === 'ENOENT' || error.code === 'ECONNREFUSED'
        ? '维护入口没开（服务没在跑，或还是 0050 之前的版本）。' : error.message;
      reject(new MaintCliError(`连不上 ${socketPath}：${hint}`));
    });
    req.end(JSON.stringify(body));
  });
}

async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseMaintArgs(argv);
  if (parsed.kind === 'db.read') {
    console.log(JSON.stringify(readDatabase(parsed.stateDir, parsed.sql!), null, 2));
    return 0;
  }
  const reply = await sendMaintenance(join(parsed.stateDir, MAINTENANCE_SOCKET_FILE), parsed.request!);
  console.log(JSON.stringify(reply.json, null, 2));
  return reply.status === 200 ? 0 : 1;
}

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }, (error: unknown) => {
    console.error(error instanceof MaintCliError ? error.message : `维护命令没跑完：${String(error)}`);
    process.exitCode = 1;
  });
}
