import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { STANDING_PROJECT_IDS } from '../../shared/state.ts';
import { ensureDefaultProjects } from '../../src/projects/default-projects.ts';
import { openTestState, type TestState } from '../state/helpers.ts';

let t: TestState;

beforeEach(async () => {
  t = await openTestState();
});

afterEach(async () => {
  await t.cleanup();
});

test('First boot creates permanent Plasticine and Personal projects with marker entry', () => {
  assert.equal(ensureDefaultProjects(t.state), true);
  const plasticine = t.state.projects.require(STANDING_PROJECT_IDS.plasticine);
  const personal = t.state.projects.require(STANDING_PROJECT_IDS.personal);
  assert.equal(plasticine.standing, true);
  assert.equal(personal.name, '个人');
  assert.deepEqual(t.state.projects.events.recent(personal.id, 5).map((event) => event.text), ['常驻项目']);
});

test('Subsequent boots do not recreate permanent projects', () => {
  ensureDefaultProjects(t.state);
  assert.equal(ensureDefaultProjects(t.state), false);
  assert.equal(t.state.projects.all().length, 2);
});
