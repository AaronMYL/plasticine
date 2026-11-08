// 本人确认统一从这里发：标识和原样请求体保存在会话之外，重试沿用原请求。
// 是否本人由服务端会话核实；不再生成或提交浏览器签名，现有待核实和版本冲突处理保持不变。

import type { SignedApi } from '../../api/client.ts';
import { ApiError, ConflictError } from '../../api/errors.ts';
import type { SignedResult, SignedTarget } from '../../api/signed-targets.ts';
import type { SignedOp, SignedOps } from '../../state/signed-ops.ts';

export interface SignedSenderDeps {
  api: SignedApi;
  ops: SignedOps;
}

/** 拿到了结果：新的一行和那次请求（第一次发、再核实、重发都一样，各 store 据此清对应的草稿）。 */
export type SignedResultListener = (result: SignedResult, op: SignedOp) => void;
/** 409 版本冲突：服务端现在那一行（形状没查过，交给对应的 store 自己认）。 */
export type SignedConflictListener = (op: SignedOp, current: unknown) => void;

export class SignedSender {
  private readonly deps: SignedSenderDeps;
  private readonly listeners = new Set<SignedResultListener>();
  private readonly conflictListeners = new Set<SignedConflictListener>();

  constructor(deps: SignedSenderDeps) {
    this.deps = deps;
  }

  /** 拿到结果的那一刻（判断、约定的新一行）告诉各个 store，不用等事件流。 */
  onResult(listener: SignedResultListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 409 带 current 的那一刻交给对应的 store：换上现在那一版，草稿留着，界面给冲突处理（审查 5087993 P2）。 */
  onConflict(listener: SignedConflictListener): () => void {
    this.conflictListeners.add(listener);
    return () => {
      this.conflictListeners.delete(listener);
    };
  }

  /** 点一次：上一次没了结就先把上一次原样再来一遍（见 SignedOps.begin）。没拿到结果返回 null，状态在 ops 里。 */
  async send(
    key: string,
    label: string,
    subject: string,
    target: SignedTarget,
    build: (requestId: string) => object,
  ): Promise<SignedResult | null> {
    return this.perform(this.deps.ops.begin(key, label, subject, target, build));
  }

  /** 再核实 / 重发。 */
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
      if (cause instanceof ConflictError) {
        for (const listener of [...this.conflictListeners]) {
          listener(op, cause.current);
        }
      }
      return null;
    }
  }
}
