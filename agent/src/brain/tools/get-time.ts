// get_time: the example read-only tool that exercises the whole path (registry → dispatch → loop) in M0.
// The same tool the 10-27 ChatGPT smoke test offered (agent/verify/chatgpt-smoke.ts).

import { Type } from 'typebox';
import { defineTool } from './registry.ts';

// Reads the local clock only; anything slower than a second is a bug, not a slow service.
const GET_TIME_TIMEOUT_MS = 1_000;

const GetTimeParameters = Type.Object(
  { timezone: Type.String({ minLength: 1, description: 'IANA time zone, e.g. Asia/Shanghai' }) },
  { additionalProperties: false },
);

function localTime(now: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: timezone,
      dateStyle: 'full',
      timeStyle: 'long',
      hourCycle: 'h23',
    }).format(now);
  } catch (error) {
    if (error instanceof RangeError) {
      throw new Error(`不认识的时区「${timezone}」，请用 IANA 时区名，例如 Asia/Shanghai。`, { cause: error });
    }
    throw error;
  }
}

export const getTimeTool = defineTool({
  name: 'get_time',
  label: '查时间',
  description: 'Returns the current time in the given IANA time zone. Call it instead of guessing the time.',
  replay: 'safe',
  effect: 'read',
  parallel: true,
  permission: 'auto',
  roles: ['conversation', 'worker', 'verifier', 'diagnosis'],
  timeoutMs: GET_TIME_TIMEOUT_MS,
  parameters: GetTimeParameters,
  async execute(args, context) {
    const now = context.now();
    return JSON.stringify({ iso: now.toISOString(), timezone: args.timezone, local: localTime(now, args.timezone) });
  },
});
