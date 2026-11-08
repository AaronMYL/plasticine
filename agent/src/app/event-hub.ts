// Fan-out of server events to the SSE streams, with a bounded buffer for Last-Event-ID replay after a reconnect.
// Event ids are `<epoch>-<n>`: the epoch changes with every process start, so an id from before a restart is
// recognised and answered with `resync` instead of a silently incomplete replay.

import { errorCategory, safeLog } from '../shared-log.ts';
import { randomUUID } from 'node:crypto';
import type { HubStreamEvent } from '../../shared/api/index.ts';
import { EVENT_BUFFER_SIZE } from './config.ts';
import { StreamText } from './stream-text.ts';

export interface HubEvent {
  id: string;
  n: number;
  event: HubStreamEvent;
}

export interface Subscription {
  /** Events after the given Last-Event-ID, oldest first. */
  replay: HubEvent[];
  /** The id could not be served (unknown epoch, or older than the buffer): the client must refetch. */
  resync: boolean;
  unsubscribe(): void;
}

/** Whose stream it is: a logout or a revoked device ends exactly the streams it opened. */
export interface StreamOwner {
  sessionId: string;
  deviceId: string;
}

interface Subscriber {
  owner: StreamOwner;
  listener: (event: HubEvent) => void;
  close: () => void;
}

// An epoch short enough to read in a log line and long enough never to repeat between two restarts.
const EPOCH_CHARS = 8;

export class EventHub {
  readonly #epoch: string;
  readonly #capacity: number;
  readonly #buffer: HubEvent[] = [];
  readonly #subscribers = new Set<Subscriber>();
  readonly #text = new StreamText();
  #n = 0;

  constructor(capacity: number = EVENT_BUFFER_SIZE, epoch: string = randomUUID().slice(0, EPOCH_CHARS)) {
    this.#capacity = capacity;
    this.#epoch = epoch;
  }

  get subscriberCount(): number {
    return this.#subscribers.size;
  }

  /**
   * The id of the newest event so far (`<epoch>-0` before the first). A new stream's `ready` carries it, so a client
   * that drops before any event arrives reconnects with a Last-Event-ID and gets what it missed (review-followups
   * e4cef52: a first connection with no id could neither replay nor ask for a resync).
   */
  cursor(): string {
    return `${this.#epoch}-${this.#n}`;
  }

  publish(event: HubStreamEvent): HubEvent {
    const entries = this.#text.take(event).map((item) => this.#publish(item));
    return entries[entries.length - 1] as HubEvent;
  }

  #publish(event: HubStreamEvent): HubEvent {
    this.#n += 1;
    const entry: HubEvent = { id: `${this.#epoch}-${this.#n}`, n: this.#n, event };
    this.#buffer.push(entry);
    if (this.#buffer.length > this.#capacity) {
      this.#buffer.shift();
    }
    for (const subscriber of [...this.#subscribers]) {
      try {
        subscriber.listener(entry);
      } catch (error) {
        // One broken stream must not keep the event from the others; that stream is closed and the client
        // reconnects with its Last-Event-ID.
        safeLog('error', 'sse_failed', { category: errorCategory(error) });
        this.#subscribers.delete(subscriber);
        subscriber.close();
      }
    }
    return entry;
  }

  subscribe(
    owner: StreamOwner,
    lastEventId: string | null,
    listener: (event: HubEvent) => void,
    close: () => void,
  ): Subscription {
    const subscriber: Subscriber = { owner, listener, close };
    this.#subscribers.add(subscriber);
    const { replay, resync } = this.#since(lastEventId);
    return {
      replay,
      resync,
      unsubscribe: () => {
        this.#subscribers.delete(subscriber);
      },
    };
  }

  /** Ends every stream (shutdown); the clients reconnect to whichever process serves next. */
  closeAll(): void {
    this.#closeWhere(() => true);
  }

  /** A logout: that session's streams stop at once, before any further event reaches them. */
  closeSession(sessionId: string): void {
    this.#closeWhere((owner) => owner.sessionId === sessionId);
  }

  /** A revoked device: every stream it has open stops at once. */
  closeDevice(deviceId: string): void {
    this.#closeWhere((owner) => owner.deviceId === deviceId);
  }

  #closeWhere(matches: (owner: StreamOwner) => boolean): void {
    for (const subscriber of [...this.#subscribers]) {
      if (matches(subscriber.owner)) {
        this.#subscribers.delete(subscriber);
        subscriber.close();
      }
    }
  }

  #since(lastEventId: string | null): { replay: HubEvent[]; resync: boolean } {
    if (lastEventId === null || lastEventId === '') {
      return { replay: [], resync: false };
    }
    const match = /^([^-]+)-(\d+)$/.exec(lastEventId);
    if (match === null || match[1] !== this.#epoch) {
      return { replay: [], resync: true };
    }
    const seen = Number(match[2]);
    const oldest = this.#buffer[0]?.n ?? this.#n + 1;
    if (seen > this.#n) {
      return { replay: [], resync: true };
    }
    if (seen + 1 < oldest) {
      return { replay: [], resync: true };
    }
    return { replay: this.#buffer.filter((entry) => entry.n > seen), resync: false };
  }
}
