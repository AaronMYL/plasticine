import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import type { BrowserInspection } from '../../shared/browser-observation.ts';
import { CloudToolError } from './errors.ts';

const BindingsSchema = Type.Record(Type.String(), Type.String());
interface Observation { id: string; tabId: string; fingerprint: string }
function fingerprint(page: BrowserInspection): string {
  // The clock or ordinary page prose can update without moving a target. Geometry, labels, focus and document
  // identity determine whether an observation still describes the controls the next action would operate.
  const { text: _text, ...targets } = page;
  return createHash('sha256').update(JSON.stringify(targets)).digest('hex');
}

export class BrowserTaskState {
  readonly #path: string | null;
  readonly #bindings: Record<string, string>;
  readonly #observations = new Map<string, Observation>();

  constructor(stateDirectory?: string) {
    this.#path = stateDirectory === undefined ? null : join(stateDirectory, 'cloud-tools', 'browser-tasks.json');
    const stored: unknown = this.#path !== null && existsSync(this.#path)
      ? JSON.parse(readFileSync(this.#path, 'utf8')) : {};
    if (!Value.Check(BindingsSchema, stored)) { throw new Error('浏览器任务标签记录损坏。'); }
    this.#bindings = stored;
  }

  tab(scope: string): string | undefined { return this.#bindings[scope]; }

  bind(scope: string, tabId: string): void {
    this.#bindings[scope] = tabId;
    this.#observations.delete(scope);
    if (this.#path === null) { return; }
    mkdirSync(dirname(this.#path), { recursive: true, mode: 0o700 });
    const temporary = `${this.#path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.#bindings), { mode: 0o600, flush: true });
    renameSync(temporary, this.#path);
  }

  observe(scope: string, tabId: string, page: BrowserInspection): string {
    const id = randomUUID();
    this.#observations.set(scope, { id, tabId, fingerprint: fingerprint(page) });
    return id;
  }

  requireObservation(scope: string, observationId: string | undefined, tabId: string, page: BrowserInspection): void {
    const observed = this.#observations.get(scope);
    if (observed === undefined || observed.id !== observationId || observed.tabId !== tabId
      || observed.fingerprint !== fingerprint(page)) {
      throw new CloudToolError('invalid_input', '网页或任务画面已变化，请重新观察后再操作。');
    }
    this.#observations.delete(scope);
  }

  invalidate(scope?: string): void {
    if (scope === undefined) { this.#observations.clear(); } else { this.#observations.delete(scope); }
  }
}
