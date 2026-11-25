import { ApiError } from '../errors.ts';
import { faultError, type FaultOperation, type FaultPlan } from './faults.ts';

type Outcome<T> = { ok: true; value: T } | { ok: false; error: ApiError };

interface Stored {
  scope: string;
  owner: string | null;
  outcome: Outcome<unknown>;
}

function isAnswer(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status !== undefined && error.status < 500 && error.status !== 401;
}

export class FakeReceipts {
  private readonly stored = new Map<string, Stored>();
  private readonly faults: FaultPlan;
  private readonly owner: () => string | null;

  constructor(faults: FaultPlan, owner: () => string | null = () => null) {
    this.faults = faults;
    this.owner = owner;
  }

  lookup<T>(id: string, allowed: (scope: string) => boolean): T | null {
    const stored = this.stored.get(id);
    if (stored === undefined) {
      return null;
    }
    if (stored.owner !== this.owner() || !allowed(stored.scope)) {
      throw new ApiError({ kind: 'invalid', code: 'result_scope_mismatch', status: 403,
        message: '这台设备不能读取这项操作的回执。' });
    }
    if (!stored.outcome.ok) {
      throw stored.outcome.error;
    }
    return structuredClone(stored.outcome.value) as T;
  }

  async run<T>(operation: FaultOperation, id: string, scope: string, work: () => T): Promise<T> {
    const fault = this.faults.take(operation);
    if (fault?.kind === 'failed' || (fault?.kind === 'uncertain' && !fault.landed)) {
      throw faultError(operation, fault);
    }
    const outcome = this.outcome(id, scope, work);
    if (fault !== undefined) {
      throw faultError(operation, fault);
    }
    if (!outcome.ok) {
      throw outcome.error;
    }
    return outcome.value;
  }

  private outcome<T>(id: string, scope: string, work: () => T): Outcome<T> {
    const previous = this.stored.get(id);
    if (previous !== undefined) {
      if (previous.scope !== scope) {
        return {
          ok: false,
          error: new ApiError({
            kind: 'failed',
            code: 'request_id_reused',
            message: '这个 request_id 已经用在另一个操作上了。',
            next: '每个新操作生成一个新的 request_id；重发同一个操作才用原来的。',
            status: 409,
          }),
        };
      }
      return previous.outcome as Outcome<T>;
    }
    let outcome: Outcome<T>;
    try {
      outcome = { ok: true, value: work() };
    } catch (error) {
      if (!isAnswer(error)) {
        throw error;
      }
      outcome = { ok: false, error };
    }
    this.stored.set(id, { scope, outcome, owner: this.owner() });
    return outcome;
  }
}
