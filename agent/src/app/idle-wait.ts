import type { IdleWait } from '../devices/index.ts';
import type { StateService } from '../state/index.ts';

const POLL_MS = 5_000;
const MAX_WAIT_MS = 15 * 60_000;
const NOTICE_EVERY_MS = 10 * 60_000;
const LINE_RUN_PREFIX = 'line:';

export interface IdleWaitParts {
  state: Pick<StateService, 'lines'>;
  now: () => Date;
  sleep(ms: number, signal: AbortSignal): Promise<boolean>;
  whoOf(mateId: string | null): string;
  post(input: { key: string; text: string; brief: string; url: string }): unknown;
}

export function idleWait(parts: IdleWaitParts): IdleWait {
  return {
    pollMs: POLL_MS,
    maxMs: MAX_WAIT_MS,
    sleep: (ms, signal) => parts.sleep(ms, signal),
    notify(runId, nodeName, purpose) {
      const lineId = runId?.startsWith(LINE_RUN_PREFIX) === true ? runId.slice(LINE_RUN_PREFIX.length) : null;
      const line = lineId === null ? undefined : parts.state.lines.get(lineId);
      const who = parts.whoOf(line?.mateId ?? null);
      const bucket = Math.floor(parts.now().getTime() / NOTICE_EVERY_MS);
      parts.post({ key: `device-idle:${runId ?? 'none'}:${bucket}`,
        text: `${who}要在${nodeName}上用一下鼠标：${purpose}。这一步网页后台做不了，等你停下键鼠 30 秒就点，`
          + '你不用停下手里的事。',
        brief: `${who}等你空闲时用一下鼠标`, url: '/' });
    },
  };
}
