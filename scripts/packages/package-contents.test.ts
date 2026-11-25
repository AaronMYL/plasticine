import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { INCLUDED_PATHS } from './package-contents.ts';

const REPO = fileURLToPath(new URL('../..', import.meta.url));

test('verifies all packaged paths exist in repo so git archive cannot fail', () => {
  for (const path of INCLUDED_PATHS) {
    assert.ok(existsSync(join(REPO, path)), path);
  }
});

test('package excludes dev skills, deploy, and release scripts while including maintenance entry', () => {
  const forbidden = [/^agent\/skills/, /^scripts$/, /^scripts\/(deploy|ship|github|cutover|preflight)/, /^\.github/];
  for (const path of INCLUDED_PATHS) {
    assert.equal(forbidden.some((pattern) => pattern.test(path)), false, path);
  }
  assert.ok(INCLUDED_PATHS.includes('scripts/maint.ts'));
});
