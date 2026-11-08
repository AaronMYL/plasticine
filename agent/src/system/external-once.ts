// 界面上发起的、有副作用的外部动作（站内信的回复发信、云端浏览器里的点击和输入）也走回执幂等（《实施方案》第 7 节）：
// 动作标识是请求的稳定标识，执行前先落 issued；同一标识再来时按 receipts.ts 的 decideReplay 决定——做过了就不再做、
// 干跑记过了不再记、说不清做没做（超时、断开、重启时还在 issued）就是「结果待核实」，等你在界面上说做没做成（settle）
// 之后才按原标识再做。外部服务明说没做成（CloudToolError 的 failed / invalid_input / not_configured / credential_unsafe）
// 记 failed，同一标识可以再做。

import type { Receipt } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';
import { argsDigest, decideReplay } from './receipts.ts';

export interface ExternalAction {
  actionId: string;
  tool: string;
  args: Record<string, unknown>;
  dryRun: boolean;
}

export type ExternalOutcome<T> =
  /** It ran now and succeeded. */
  | { kind: 'done'; value: T; receipt: Receipt }
  /** It had already succeeded under this id (or you confirmed it did); nothing ran. */
  | { kind: 'already_done'; receipt: Receipt }
  /** Development dry run: recorded, not executed (10-26 第 8 条). */
  | { kind: 'dry_run'; receipt: Receipt }
  /** The outside service said it did not act; the same id may run again. */
  | { kind: 'failed'; error: unknown; receipt: Receipt }
  /** It may or may not have acted: verify first (settle), nothing is redone meanwhile. */
  | { kind: 'unknown'; receipt: Receipt }
  /** The id belongs to a different action (other arguments). */
  | { kind: 'conflict' };

/** Whether an error means the outside service definitely did not act. */
export type DefiniteFailure = (error: unknown) => boolean;

export async function runExternalOnce<T>(
  state: StateService,
  action: ExternalAction,
  definite: DefiniteFailure,
  perform: () => Promise<T>,
  now: () => Date,
): Promise<ExternalOutcome<T>> {
  const digest = argsDigest(action.args);
  const tool = { name: action.tool, replay: 'once' as const, effect: 'external' as const };
  const issued = state.receipts.issue({
    actionId: action.actionId,
    tool: action.tool,
    argsDigest: digest,
    replay: 'once',
    effect: 'external',
    receivedAt: now().toISOString(),
  });
  let receipt = issued.receipt;
  if (!issued.created) {
    const decision = decideReplay({ receipt, tool, digest, dryRun: action.dryRun });
    switch (decision.kind) {
      case 'conflict':
        return { kind: 'conflict' };
      case 'reuse':
      case 'confirmed_done':
        return { kind: 'already_done', receipt };
      case 'dry_run_again':
        return { kind: 'dry_run', receipt };
      case 'unknown':
        return { kind: 'unknown', receipt };
      case 'run':
        receipt = state.receipts.update(receipt.actionId, receipt.version, { status: 'issued' });
        break;
    }
  }
  const attempt = (receipt.attempt ?? 0) + 1;
  if (action.dryRun) {
    const dry = state.receipts.update(receipt.actionId, receipt.version, { status: 'dry_run', attempt });
    return { kind: 'dry_run', receipt: dry };
  }
  receipt = state.receipts.update(receipt.actionId, receipt.version, { attempt, deliveredAt: now().toISOString() });
  try {
    const value = await perform();
    const executedAt = now().toISOString();
    const stored = state.receipts.get(receipt.actionId) ?? receipt;
    const done = state.receipts.update(stored.actionId, stored.version, {
      status: 'succeeded',
      executedAt,
      resultRef: `external:${action.tool}`,
    });
    return { kind: 'done', value, receipt: done };
  } catch (error) {
    const stored = state.receipts.get(receipt.actionId) ?? receipt;
    const status = definite(error) ? 'failed' : 'unknown';
    const after = state.receipts.update(stored.actionId, stored.version, { status });
    return status === 'failed' ? { kind: 'failed', error, receipt: after } : { kind: 'unknown', receipt: after };
  }
}

/**
 * You looked and said whether it happened (结果待核实 → 核实了): done means it is never redone; not done means the
 * same id may run again. Only for an action still unknown (or issued); anything else is left as it is.
 */
export function settleExternal(
  state: StateService,
  actionId: string,
  happened: boolean,
  now: () => Date,
): Receipt | undefined {
  const receipt = state.receipts.get(actionId);
  if (receipt === undefined) {
    return undefined;
  }
  if (receipt.status !== 'unknown' && receipt.status !== 'issued') {
    return receipt;
  }
  const status = happened ? 'succeeded' : 'failed';
  return state.receipts.update(actionId, receipt.version, { status, resultRef: null, verifiedAt: now().toISOString() });
}
