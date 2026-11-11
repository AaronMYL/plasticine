// 长期维护入口的命令行（第 115 条）：随服务包装在 /opt/plasticine，在服务器上以服务用户跑，不用每次现写临时脚本：
//
//   sudo -n -u plasticine /opt/plasticine/node/bin/node /opt/plasticine/current/scripts/maint.ts <命令> [参数] \
//     [--state <数据目录>]
// 数据目录按 --state、PLASTICINE_STATE、默认值的顺序取。
//
// 命令：
//   status                                   线按状态计数、规则档位、最近的维护操作
//   rules.list
//   rules.mode --code feed_interest --mode off --because "用户原话" [--op-id 号]
//   mail.refetch [--limit 30] --because "用户原话" [--op-id 号]
//                                            还没补格式的旧邮件从 Gmail「所有邮件」只读地找回整封、原地补（默认 30 封，
//                                            最多 200）；结果报找到 / 没找到 / 出错和还剩几封，还剩的换个操作号再跑
//   rules.rewrite --plan <方案.json> --because "用户原话" [--op-id 号]
//                                            整理「规则」：一行换成几行或挪进归档（brain/rules-rewrite.ts）
//   db.read "SELECT …"                       只读打开数据库查一句（不经服务，库以只读方式打开）
//
// 2026-11-05 Harness 重做：任务没了，tasks.* 删掉；judgments.*、rulesdoc.* 的一次性迁移早已做完，一起删了。
// 写操作必须带 --because（用户的原话），经运行中的服务做（本机 socket），事件里记成 Claude 依原话做的；
// 同一个 --op-id 重跑不会再动一次。

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
import { RULE_MODES, type RuleMode } from '../agent/shared/state.ts';

/** 线上状态目录（systemd 里的 PLASTICINE_STATE）。 */
const DEFAULT_STATE = '/home/plasticine/state/agent';
const DATABASE_FILE = 'plasticine.sqlite';
/** 只读查询只放行这几种开头；库本身也以只读方式打开。 */
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

function isMode(value: string): value is RuleMode {
  return (RULE_MODES as readonly string[]).includes(value);
}

function newOperationId(now: Date): string {
  return `maint-${now.toISOString().replace(/[^0-9]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** --plan：rules.rewrite 的整理方案，一个 JSON 文件（数组）。 */
function readPlan(path: string): NonNullable<MaintenanceRequest['plan']> {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new MaintCliError(`--plan 读不成：${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(value)) throw new MaintCliError('--plan 要是一个 JSON 数组。');
  return value as NonNullable<MaintenanceRequest['plan']>;
}

/** 命令行参数 → 一条维护命令（或一句只读查询）。 */
export function parseMaintArgs(argv: readonly string[], env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date()): ParsedCommand {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      because: { type: 'string' },
      code: { type: 'string' },
      mode: { type: 'string' },
      'op-id': { type: 'string' },
      state: { type: 'string' },
      limit: { type: 'string' },
      plan: { type: 'string' },
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
  if (values.mode !== undefined && !isMode(values.mode)) {
    throw new MaintCliError(`--mode 只能是 ${RULE_MODES.join(' / ')}。`);
  }
  const limit = values.limit === undefined ? undefined : Number(values.limit);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > MAIL_REFETCH_MAX_LIMIT)) {
    throw new MaintCliError(`--limit 要是 1 到 ${MAIL_REFETCH_MAX_LIMIT} 的整数。`);
  }
  const request: MaintenanceRequest = {
    operationId: values['op-id'] ?? newOperationId(now),
    op: command,
    ...(values.because === undefined ? {} : { because: values.because }),
    ...(values.code === undefined ? {} : { code: values.code }),
    ...(values.mode === undefined ? {} : { mode: values.mode as RuleMode }),
    ...(limit === undefined ? {} : { limit }),
    ...(values.plan === undefined ? {} : { plan: readPlan(values.plan) }),
  };
  return { kind: 'socket', stateDir, request };
}

/** 只读打开数据库查一句；写语句会被库本身拒绝。 */
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

/** 把一条维护命令送进运行中的服务（本机 socket），回服务的回答。 */
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
