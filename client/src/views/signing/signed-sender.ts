import type { SignedApi } from '../../api/client.ts';
import { ApiError } from '../../api/errors.ts';
import type { SignedResult, SignedTarget } from '../../api/signed-targets.ts';
import type { SignedOp, SignedOps } from '../../state/signed-ops.ts';

export interface SignedSenderDeps {
  api: SignedApi;
  ops: SignedOps;
}

export type SignedResultListener = (result: SignedResult, op: SignedOp) => void;

export class SignedSender {
  private readonly deps: SignedSenderDeps;
  private readonly listeners = new Set<SignedResultListener>();

  constructor(deps: SignedSenderDeps) {
    this.deps = deps;
  }

  onResult(listener: SignedResultListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async send(
    key: string,
    label: string,
    subject: string,
    target: SignedTarget,
    build: (requestId: string) => object,
  ): Promise<SignedResult | null> {
    return this.perform(this.deps.ops.begin(key, label, subject, target, build));
  }

  async retry(key: string): Promise<SignedResult | null> {
    const lookup = this.deps.ops.get(key)?.unresolved === true;
    const op = this.deps.ops.retry(key);
    return op === undefined ? null : this.perform(op, lookup);
  }

  dismiss(key: string): void {
    this.deps.ops.dismiss(key);
  }

  private async perform(op: SignedOp, lookup = false): Promise<SignedResult | null> {
    const { api, ops } = this.deps;
    try {
      let result: SignedResult | null;
      if (lookup && op.target.kind !== 'node_pairing_code') {
        result = await api.lookup(op.requestId, op.target);
        if (result === null) {
          throw new ApiError({ kind: 'not_found', code: 'result_not_found',
            message: '没有收到这个操作，可以用原标识重发。' });
        }
      } else {
        result = await api.send({ target: op.target, bodyText: op.bodyText });
      }
      ops.succeed(op.key);
      for (const listener of [...this.listeners]) {
        listener(result, op);
      }
      return result;
    } catch (cause) {
      ops.fail(op.key, cause);
      return null;
    }
  }
}
