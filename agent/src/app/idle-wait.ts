// 真鼠标等他空闲时怎么告诉他（11-16 用户定：告诉我，但不停下来，等我空闲再用真鼠标）：主线上一条通知加系统通知，
// 说清是谁、要点什么、等他停 30 秒就点；同一条线十分钟里只说一次。等本身在设备权限门里（devices/device-action.ts）。

import type { IdleWait } from '../devices/index.ts';
import type { StateService } from '../state/index.ts';

/** 他 30 秒没动键鼠算空闲（devices/holds.ts）；设备每分钟报一次，五秒看一回够了。 */
const POLL_MS = 5_000;
/** 最多在一步里等这么久，再久就把「他正在用」交回给线，让它换路或晚点再试。 */
const MAX_WAIT_MS = 15 * 60_000;
/** 同一条线这么久里只告诉他一次。 */
const NOTICE_EVERY_MS = 10 * 60_000;
const LINE_RUN_PREFIX = 'line:';

export interface IdleWaitParts {
  state: Pick<StateService, 'lines'>;
  now: () => Date;
  sleep(ms: number, signal: AbortSignal): Promise<boolean>;
  /** 谁在等：主线的名字或队友的名字。 */
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
