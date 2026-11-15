// 图书的模型调用：一次请求、只要一段 JSON 回答。模型调用只从脑发出（plasticine-code 边界）。

import type { TSchema, Static } from 'typebox';
import { Value } from 'typebox/value';
import type { TextModels } from '../kernel/index.ts';
import type { ModelPurpose } from '../../shared/api/model-purposes.ts';

// 一本书逐段归纳，每段最多等 3 分钟；超时就算这一次失败，界面上可以重新生成。
const CALL_TIMEOUT_MS = 180_000;
const OUTPUT_TOKENS = 16_000;

/** 图书与记忆共用的 JSON 调用口；实际模型与思考由调用用途决定。 */
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

/**
 * 模型用 null 表示「没有」：当成这一项没写。不先去掉的话，Value.Convert 会把 null 转成字符串 "null"
 * （11-08 上线后心跳在主线上发了一条正文是「null」的消息）。必填项是 null 照样过不了 schema，报错不猜。
 */
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

/** 问一次，拿回一段过了 schema 的 JSON；说不清的回答直接报错，不猜。 */
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
