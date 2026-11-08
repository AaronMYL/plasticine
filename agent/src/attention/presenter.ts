// Shows what a committed operation changed: every card goes to the devices' event streams (the sink app/ attaches), and
// a card on the 立刻打断 channel also goes out as a Web Push. Called only after the transaction has committed; a stream
// or push that fails is logged and does not undo what is already stored.

import { errorCategory, safeLog, type LogEvent } from '../shared-log.ts';
import type { Ask } from '../../shared/state.ts';
import { isDeferredStandaloneAsk } from '../../shared/api/asks.ts';
import type { StateService } from '../state/index.ts';
import type { Changes } from './changes.ts';
import { pushes } from './channels.ts';
import { currentAsk } from './order.ts';

export interface PresentationSink {
  askCreated(ask: Ask, current: boolean): void;
  askAnswered(ask: Ask): void;
  askUpdated(ask: Ask): void;
}

/** Sends the system notification for an interrupting card (push.ts). */
export interface Notifier {
  notify(ask: Ask): Promise<unknown>;
}

const NO_SINK: PresentationSink = {
  askCreated: () => undefined,
  askAnswered: () => undefined,
  askUpdated: () => undefined,
};

export type PresenterState = Pick<StateService, 'asks'>;

export class Presenter {
  readonly #state: PresenterState;
  #sink: PresentationSink = NO_SINK;
  #notifier: Notifier | undefined;
  readonly #pending = new Set<Promise<void>>();

  constructor(state: PresenterState) {
    this.#state = state;
  }

  /** The event streams; until app/ attaches them, changes are only stored. */
  attach(sink: PresentationSink): void {
    this.#sink = sink;
  }

  setNotifier(notifier: Notifier): void {
    this.#notifier = notifier;
  }

  present(changes: Changes): void {
    for (const { askId, change } of changes.asks) {
      const ask = this.#state.asks.get(askId);
      if (ask === undefined) {
        continue;
      }
      this.#safely(`卡 ${askId}`, () => this.#presentAsk(ask, change));
    }
    for (const action of changes.followUps) {
      this.#safely('提交之后的后续动作', action);
    }
  }

  /** Resolves when every push started so far has finished (tests, shutdown). */
  async settled(): Promise<void> {
    while (this.#pending.size > 0) {
      await Promise.allSettled([...this.#pending]);
    }
  }

  #presentAsk(ask: Ask, change: Changes['asks'][number]['change']): void {
    if (change === 'answered') {
      this.#sink.askAnswered(ask);
      return;
    }
    if (change === 'updated') {
      this.#sink.askUpdated(ask);
      return;
    }
    const current = currentAsk(this.#state.asks.open())?.id === ask.id;
    this.#sink.askCreated(ask, current);
    if (ask.status === 'open' && !isDeferredStandaloneAsk(ask)
      && pushes(ask.channel) && this.#notifier !== undefined) {
      this.#track(this.#notifier.notify(ask), ask.id, 'ask_notify_failed');
    }
  }

  #track(work: Promise<unknown>, askId: string, failure: LogEvent): void {
    const pending: Promise<void> = work
      .then(() => undefined, (error: unknown) => {
        safeLog('error', failure, { objectId: askId, category: errorCategory(error) });
      })
      .finally(() => {
        this.#pending.delete(pending);
      });
    this.#pending.add(pending);
  }

  #safely(what: string, publish: () => void): void {
    try {
      publish();
    } catch (error) {
      // Stored already; a device that missed it catches up on reconnect (Last-Event-ID or resync).
      safeLog('error', 'attention_publish_failed', { category: errorCategory(error) });
    }
  }
}
