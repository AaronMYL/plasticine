import { NOTICE_TITLE, type NotifyKind, type PushPayload } from '../../shared/api/push.ts';
import { errorCategory, safeLog } from '../util/index.ts';
import type { StateService } from '../state/index.ts';

const NOTICE_TOOL = 'main_notice';

export interface NoticeInput {
  key: string;
  text: string;
  brief: string;
  url: string;
}

export type NoticeKind = Extract<NotifyKind, 'letter' | 'notice'>;

export interface NoticePoster {
  post(input: NoticeInput): boolean;
}

export interface NoticesOptions {
  state: Pick<StateService, 'receipts' | 'transaction'>;
  post: (input: NoticeInput) => void;
  push: { announce(payload: PushPayload, kind?: NotifyKind): Promise<unknown> };
  now: () => Date;
}

export class Notices implements NoticePoster {
  readonly #options: NoticesOptions;
  readonly #pending = new Set<Promise<void>>();

  constructor(options: NoticesOptions) {
    this.#options = options;
  }

  post(input: NoticeInput): boolean {
    const { state, now } = this.#options;
    const fresh = state.transaction(() => {
      const issued = state.receipts.issue({ actionId: input.key, tool: NOTICE_TOOL, argsDigest: input.key,
        replay: 'once', effect: 'internal', receivedAt: now().toISOString() });
      if (!issued.created) {
        return false;
      }
      this.#options.post(input);
      state.receipts.update(input.key, issued.receipt.version, { status: 'succeeded',
        executedAt: now().toISOString() });
      return true;
    });
    if (fresh) {
      this.announce({ body: input.brief, url: input.url, tag: input.key });
    }
    return fresh;
  }

  announce(input: { body: string; url: string; tag: string }, kind: NoticeKind = 'notice'): void {
    const work = this.#options.push.announce({ title: NOTICE_TITLE, ...input }, kind);
    const pending: Promise<void> = work.then(() => undefined, (error: unknown) => {
      safeLog('error', 'notice_push_failed', { category: errorCategory(error) });
    }).finally(() => {
      this.#pending.delete(pending);
    });
    this.#pending.add(pending);
  }

  async settled(): Promise<void> {
    while (this.#pending.size > 0) {
      await Promise.allSettled([...this.#pending]);
    }
  }
}
