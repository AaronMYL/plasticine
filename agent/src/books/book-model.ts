import type { TSchema, Static } from 'typebox';
import { Value } from 'typebox/value';
import type { TextModels } from '../kernel/index.ts';
import type { ModelPurpose } from '../../shared/api/model-purposes.ts';

const CALL_TIMEOUT_MS = 180_000;
const OUTPUT_TOKENS = 16_000;

export interface BookModel {
  models: TextModels;
}

function jsonText(raw: string): string {
  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n```/.exec(raw);
  const body = fenced?.[1] ?? raw;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  return start === -1 || end < start ? body : body.slice(start, end + 1);
}

export function dropNulls(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.filter((item) => item !== null).map(dropNulls);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null)
      .map(([key, item]) => [key, dropNulls(item)]));
  }
  return value;
}

export async function askJson<T extends TSchema>(book: BookModel, schema: T, system: string, user: string,
  signal: AbortSignal, purpose: ModelPurpose): Promise<Static<T>> {
  const timeout = AbortSignal.timeout(CALL_TIMEOUT_MS);
  const combined = AbortSignal.any([signal, timeout]);
  let raw: string;
  try {
    const answer = await book.models.ask({ system, messages: [{ role: 'user', content: user }],
      purpose, maxOutputTokens: OUTPUT_TOKENS }, combined);
    raw = answer.text;
  } catch (cause) {
    signal.throwIfAborted();
    if (timeout.aborted) {
      throw new Error('模型超过 3 分钟没有回答，这一次没有保存。', { cause });
    }
    throw new Error(`模型没有给出结果：${cause instanceof Error ? cause.message : String(cause)}`, { cause });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText(raw));
  } catch (cause) {
    throw new Error('模型的回答不是能读的 JSON，这一次没有保存。', { cause });
  }
  const present = dropNulls(parsed);
  const cleaned = Value.Clean(schema, Value.Convert(schema, present));
  if (!Value.Check(schema, cleaned)) {
    throw new Error('模型的回答格式不对，这一次没有保存。');
  }
  return cleaned;
}
