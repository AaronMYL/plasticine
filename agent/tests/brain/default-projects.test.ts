import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { STANDING_PROJECT_IDS } from '../../shared/state.ts';
import { ensureDefaultProjects } from '../../src/brain/default-projects.ts';
import { openTestState, type TestState } from '../state/helpers.ts';

let t: TestState;

beforeEach(async () => {
  t = await openTestState();
});

afterEach(async () => {
  await t.cleanup();
});

test('第一次启动建 Plasticine、个人两个常驻项目，各记一条「常驻项目」', () => {
  assert.equal(ensureDefaultProjects(t.state), true);
  const plasticine = t.state.projects.require(STANDING_PROJECT_IDS.plasticine);
  const personal = t.state.projects.require(STANDING_PROJECT_IDS.personal);
  assert.equal(plasticine.standing, true);
  assert.equal(personal.name, '个人');
  assert.deepEqual(t.state.projects.events.recent(personal.id, 5).map((event) => event.text), ['常驻项目']);
});

test('再启动不重复建', () => {
  ensureDefaultProjects(t.state);
  assert.equal(ensureDefaultProjects(t.state), false);
  assert.equal(t.state.projects.all().length, 2);
});
