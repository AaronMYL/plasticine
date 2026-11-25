import type { Ask } from '../../shared/state.ts';
import { AskDesk, Presenter, type PresentationSink } from '../../src/attention/index.ts';
import { openState, type StateService } from '../../src/state/index.ts';

export const START = Date.parse('2026-10-27T08:00:00.000Z');

export interface MovableClock {
  now: () => Date;
  advance(ms: number): void;
}

/** One millisecond per reading, so stored times are distinct and ordered; `advance` jumps ahead. */
export function movableClock(): MovableClock {
  let current = START;
  return {
    now: () => {
      current += 1;
      return new Date(current);
    },
    advance: (ms) => {
      current += ms;
    },
  };
}

export type Presented =
  | { type: 'ask_created'; ask: Ask; current: boolean }
  | { type: 'ask_answered'; ask: Ask }
  | { type: 'ask_updated'; ask: Ask };

export interface Harness {
  state: StateService;
  clock: MovableClock;
  desk: AskDesk;
  presenter: Presenter;
  presented: Presented[];
  close(): void;
}

/** `path`: a library file to open (an upgrade test prepares it first); in memory otherwise. */
export function harness(path = ':memory:'): Harness {
  const clock = movableClock();
  const state = openState({ path, now: () => clock.now().toISOString() });
  const presented: Presented[] = [];
  const sink: PresentationSink = {
    askCreated: (ask, current) => presented.push({ type: 'ask_created', ask, current }),
    askAnswered: (ask) => presented.push({ type: 'ask_answered', ask }),
    askUpdated: (ask) => presented.push({ type: 'ask_updated', ask }),
  };
  const presenter = new Presenter(state);
  presenter.attach(sink);
  const desk = new AskDesk({ state, presenter, now: clock.now });
  return { state, clock, desk, presenter, presented, close: () => state.close() };
}
