import type { Row } from './db.ts';
import type { StoreContext } from './object-store.ts';

export interface ModelCallInput {
  purpose: string;
  lineId?: string | null;
  provider: string;
  model: string;
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  cost: number;
}

export interface UsageRow {
  at: string;
  purpose: string;
  lineId: string | null;
  provider: string;
  model: string;
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  cost: number;
}

function count(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function usageOf(row: Row): UsageRow {
  return {
    at: String(row['at']),
    purpose: String(row['purpose']),
    lineId: row['line_id'] === null || row['line_id'] === undefined ? null : String(row['line_id']),
    provider: String(row['provider'] ?? ''),
    model: String(row['model'] ?? ''),
    input: Math.round(count(row['input'])),
    cacheRead: Math.round(count(row['cache_read'])),
    cacheWrite: Math.round(count(row['cache_write'])),
    output: Math.round(count(row['output'])),
    cost: count(row['cost']),
  };
}

export function createModelCallStore(context: StoreContext) {
  const { db } = context;
  return {
    record(call: ModelCallInput): void {
      db.run(`INSERT INTO model_calls (created_at, purpose, line_id, provider, model, input, cache_read, cache_write,
        output, cost) VALUES ($at, $purpose, $lineId, $provider, $model, $input, $cacheRead, $cacheWrite, $output,
        $cost)`, { at: context.now(), purpose: call.purpose, lineId: call.lineId ?? null, provider: call.provider,
        model: call.model, input: Math.round(count(call.input)), cacheRead: Math.round(count(call.cacheRead)),
        cacheWrite: Math.round(count(call.cacheWrite)), output: Math.round(count(call.output)),
        cost: count(call.cost) });
    },
    usageSince(since: string): UsageRow[] {
      return db.all(`SELECT m.created_at AS at,
          CASE WHEN l.sealed_prompt IS NOT NULL THEN 'network_reply' WHEN l.kind = 'background' THEN 'agent'
            ELSE l.kind END AS purpose,
          m.line_id AS line_id,
          json_extract(m.message, '$.provider') AS provider, json_extract(m.message, '$.model') AS model,
          json_extract(m.message, '$.usage.input') AS input, json_extract(m.message, '$.usage.cacheRead') AS cache_read,
          json_extract(m.message, '$.usage.cacheWrite') AS cache_write,
          json_extract(m.message, '$.usage.output') AS output, json_extract(m.message, '$.usage.cost.total') AS cost
        FROM line_messages m JOIN lines l ON l.id = m.line_id
        WHERE m.role = 'assistant' AND m.created_at >= $since
        UNION ALL
        SELECT created_at AS at, purpose, line_id, provider, model, input, cache_read, cache_write, output, cost
        FROM model_calls WHERE created_at >= $since`, { since }).map(usageOf)
        .filter((row) => row.input + row.cacheRead + row.cacheWrite + row.output > 0);
    },
  };
}

export type ModelCallStore = ReturnType<typeof createModelCallStore>;
