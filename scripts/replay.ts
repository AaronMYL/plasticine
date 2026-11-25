import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { clampThinkingLevel, type Message } from '@earendil-works/pi-ai';
import { assembleApp } from '../agent/src/app/assemble.ts';
import { generateVapidKeys } from '../agent/src/attention/index.ts';
import { KernelModels, ProviderLogins } from '../agent/src/kernel/index.ts';
import { convertToLlm, declareLoaded, historyMessages, type ModelChoice } from '../agent/src/lines/index.ts';
import { openState, type StateService } from '../agent/src/state/index.ts';
import { casesByRef, DEFAULT_PICK, pickCases, type ReplayCase } from './replay/cases.ts';
import { replayCase, summarize, type CaseResult } from './replay/run.ts';

const TOKEN_MARGIN_MS = 20 * 60 * 1000;
const CASE_TIMEOUT_MS = 180_000;

class ReplayError extends Error {}

function copyDatabase(source: string, target: string): void {
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
  } finally {
    db.close();
  }
}

function freezeCredentials(models: KernelModels): void {
  models.credentials.modify = async () => {
    throw new ReplayError('回放里不刷新登录');
  };
}

function tokenExpiry(state: StateService, providerId: string): number | null {
  const stored = state.kernelCredentials.read(providerId)?.credential;
  const expires = typeof stored === 'object' && stored !== null ? Reflect.get(stored, 'expires') : undefined;
  return typeof expires === 'number' ? expires : null;
}

const CONTEXT_ROWS = 30;
const OPENING_ROLES: ReadonlySet<string> = new Set(['user', 'handoff', 'lineReport', 'notice']);

function contextOf(state: StateService, item: ReplayCase, deferred: ReadonlyMap<string, AgentTool>): Message[] {
  const rows = state.lineMessages.page(item.lineId, item.seq + 1, CONTEXT_ROWS).rows;
  const start = rows.findIndex((row) => OPENING_ROLES.has(row.role));
  if (rows.at(-1)?.seq !== item.seq || start === -1) {
    throw new ReplayError(`副本里没有 ${item.ref}`);
  }
  return convertToLlm(declareLoaded(historyMessages(item.lineId, rows.slice(start)), deferred));
}

function readRefs(path: string): string[] {
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new ReplayError('--cases 要一个 JSON 字符串数组（line:<线>:<序号>）');
  }
  return value;
}

function withModel(models: KernelModels, choice: ModelChoice | undefined, id: string | undefined): ModelChoice {
  if (choice === undefined) {
    throw new ReplayError('副本里没有连上的模型');
  }
  if (id === undefined) {
    return choice;
  }
  const model = models.models.getModel(choice.model.provider, id);
  if (model === undefined) {
    throw new ReplayError(`「${choice.model.provider}」没有型号「${id}」`);
  }
  return { model, thinking: clampThinkingLevel(model, choice.thinking) };
}

async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({ args: argv, options: { db: { type: 'string' }, skills: { type: 'string' },
    cases: { type: 'string' }, count: { type: 'string' }, out: { type: 'string' }, model: { type: 'string' } } });
  if (values.db === undefined) {
    throw new ReplayError('要 --db <plasticine.sqlite>');
  }
  const work = mkdtempSync(join(tmpdir(), 'plasticine-replay-'));
  try {
    const copy = join(work, 'plasticine.sqlite');
    copyDatabase(values.db, copy);
    if (values.skills !== undefined && existsSync(values.skills)) {
      cpSync(values.skills, join(work, 'skills'), { recursive: true });
    }
    const state = openState({ path: copy, notesDirectory: join(work, 'notes') });
    try {
      return await replay(state, work, values);
    } finally {
      state.close();
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function replay(state: StateService, work: string,
  values: { cases?: string | undefined; count?: string | undefined; out?: string | undefined;
    model?: string | undefined }): Promise<number> {
  const models = new KernelModels({ state });
  freezeCredentials(models);
  await models.refreshAccountModels({ network: false });
  const app = assembleApp({ state, dryRun: true, vapidKeys: generateVapidKeys(), vapidSubject: 'https://replay.invalid',
    pushTransport: async () => ({ status: 201 }), stateDirectory: work, memoryCuration: false,
    automaticBackups: false, network: { autoSync: false, responder: false },
    lines: { models }, kernelModels: { models, logins: new ProviderLogins(models) }, illustrator: null,
    transcriberKit: { ports: { download: async () => {
      throw new ReplayError('回放不下载');
    } } } });
  const kernel = app.deps.lines;
  const db = new DatabaseSync(join(work, 'plasticine.sqlite'), { readOnly: true });
  const cases = values.cases === undefined
    ? pickCases(db, { ...DEFAULT_PICK, count: Number(values.count ?? DEFAULT_PICK.count) })
    : casesByRef(db, readRefs(values.cases));
  db.close();
  const results: CaseResult[] = [];
  let surface: { promptChars: number; tools: number; toolChars: number } | null = null;
  for (const item of cases) {
    const preview = kernel.preview(item.lineId);
    const choice = withModel(models, preview.choice, values.model);
    const expires = tokenExpiry(state, choice.model.provider);
    if (expires !== null && expires - Date.now() < TOKEN_MARGIN_MS) {
      throw new ReplayError('订阅登录的令牌快到期了：等服务自己刷新以后再跑');
    }
    surface ??= { promptChars: Array.from(preview.prompt).length, tools: preview.tools.length,
      toolChars: Array.from(JSON.stringify(preview.tools.map((tool) => ({ name: tool.name,
        description: tool.description, parameters: tool.parameters })))).length };
    const signal = AbortSignal.timeout(CASE_TIMEOUT_MS);
    const model = { model: choice.model, complete: (context: Parameters<KernelModels['complete']>[1],
      abort: AbortSignal) => models.complete(choice.model, context, { signal: abort, reasoning: choice.thinking }) };
    const declared = new Set(preview.tools.map((tool) => tool.name));
    const deferred = new Map(preview.all.filter((tool) => !declared.has(tool.name)).map((tool) => [tool.name, tool]));
    results.push(await replayCase(item, preview, contextOf(state, item, deferred), model, signal));
  }
  const report = { model: withModel(models, kernel.preview('main').choice, values.model).model.id, surface,
    summary: summarize(results), refs: cases.map((item) => item.ref), results };
  if (values.out !== undefined) {
    writeFileSync(values.out, JSON.stringify(report, null, 1));
  }
  console.log(JSON.stringify(report));
  return report.summary.errors === report.summary.cases && report.summary.cases > 0 ? 1 : 0;
}

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
}, (error: unknown) => {
  console.error(error instanceof ReplayError ? error.message : `回放没跑完：${String(error)}`);
  process.exitCode = 1;
});
