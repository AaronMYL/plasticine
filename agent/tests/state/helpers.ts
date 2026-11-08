// Test factories for state/: a temporary library per test (deleted afterwards), a pinned clock and minimal valid
// inputs for every object, so each test only spells out the fields it is about.

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Change, DeviceConfirmation } from '../../shared/state.ts';
import { openState, StateError, type StateErrorCode, type StateService } from '../../src/state/index.ts';

export const START = Date.parse('2026-10-27T08:00:00.000Z');
const TICK_MS = 1000;

export interface TestState {
  state: StateService;
  path: string;
  /** Closes the library once; later calls do nothing. */
  close(): void;
  /** Closes the library (if still open) and deletes its directory, WAL files included. */
  cleanup(): Promise<void>;
}

/** A clock that moves one second per reading, so created / updated times are distinct and ordered. */
export function steppingClock(): () => string {
  let now = START;
  return () => {
    now += TICK_MS;
    return new Date(now).toISOString();
  };
}

export async function openTestState(): Promise<TestState> {
  const directory = await mkdtemp(join(tmpdir(), 'plasticine-state-'));
  const path = join(directory, 'plasticine.sqlite');
  const state = openState({ path, now: steppingClock() });
  let closed = false;
  const close = (): void => {
    if (!closed) {
      closed = true;
      state.close();
    }
  };
  return {
    state,
    path,
    close,
    async cleanup() {
      close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

export async function tempDirectory(): Promise<{ directory: string; cleanup(): Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), 'plasticine-state-'));
  return { directory, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

export function brainChange(reason = '脑整理时补上'): Change {
  return { actor: 'brain', actorRef: 'run-1', reason };
}

export function userChange(reason = '用户在记忆页改了一句'): Change {
  return { actor: 'user', reason, reasonKind: 'user_correction' };
}

export function device(deviceId = 'iphone-1'): DeviceConfirmation {
  return { deviceId, confirmedAt: new Date(START).toISOString() };
}

/**
 * 旧记忆条目要一个来源 id。来源账（sources）2026-11-05 删掉了，旧条目留着原来的 id，测试随便给一个。
 */
export function userSource(_state: StateService): string {
  return 'source-user-said';
}

/**
 * Lets a test send what the type system would refuse, standing in for unchecked outside input (a request body,
 * a model's tool arguments) that the store must reject at run time.
 */
export function forged<T>(value: unknown): T {
  return value as T;
}

/** Asserts that `work` throws a StateError with `code` and returns it for further checks. */
export function throwsState(work: () => unknown, code: StateErrorCode): StateError {
  try {
    work();
  } catch (error) {
    assert.ok(error instanceof StateError, `应抛 StateError，实际是 ${String(error)}`);
    assert.equal(error.code, code, error.message);
    return error;
  }
  assert.fail(`应抛 ${code}，实际没有抛错`);
}
