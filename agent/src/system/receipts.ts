import { createHash } from 'node:crypto';
import type { Receipt } from '../../shared/state.ts';
import type { ToolDescriptor } from '../../shared/tools.ts';

/** Object keys sorted at every level, so the same arguments always give the same digest. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).sort(([a], [b]) => compareKeys(a, b));
    return Object.fromEntries(entries.map(([key, inner]) => [key, sortKeys(inner)]));
  }
  return value;
}

/** Code-unit order, not locale order: the digest must not depend on the host's locale. */
function compareKeys(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

export function argsDigest(args: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalJson(args)).digest('hex');
}

/**
 * What to do with a call whose action id already has a receipt:
 * - `run`: execute (again) — a safe tool, a dry run that may now really happen, or a failed once action (it threw,
 *   or you confirmed it did not happen);
 * - `reuse`: hand back the stored result of the earlier execution;
 * - `dry_run_again`: still in the development dry run, record nothing new;
 * - `confirmed_done`: the user confirmed it happened, though its result was never recorded — do not do it again;
 * - `conflict`: the id belongs to a different call;
 * - `unknown`: it may have happened (issued without a result, unknown, or a result that cannot be found).
 */
export type ReplayDecision =
  | { kind: 'run' }
  | { kind: 'reuse'; resultRef: string }
  | { kind: 'confirmed_done' }
  | { kind: 'dry_run_again' }
  | { kind: 'conflict' }
  | { kind: 'unknown' };

export interface ReplayInput {
  receipt: Receipt;
  tool: Pick<ToolDescriptor, 'name' | 'replay' | 'effect'>;
  digest: string;
  dryRun: boolean;
}

export function decideReplay({ receipt, tool, digest, dryRun }: ReplayInput): ReplayDecision {
  if (receipt.tool !== tool.name || receipt.argsDigest !== digest) {
    return { kind: 'conflict' };
  }
  if (receipt.status === 'dry_run') {
    return dryRun && tool.effect === 'external' ? { kind: 'dry_run_again' } : { kind: 'run' };
  }
  if (tool.replay === 'safe') {
    return { kind: 'run' };
  }
  if (receipt.status === 'failed') {
    return { kind: 'run' };
  }
  if (receipt.status === 'succeeded' && receipt.resultRef === null && receipt.verifiedAt !== null) {
    return { kind: 'confirmed_done' };
  }
  if (receipt.status === 'succeeded' && receipt.resultRef !== null) {
    return { kind: 'reuse', resultRef: receipt.resultRef };
  }
  return { kind: 'unknown' };
}
