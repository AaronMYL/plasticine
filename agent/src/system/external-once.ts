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
