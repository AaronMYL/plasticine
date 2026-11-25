import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('full test keeps server, script, desktop discovery and client chain with 2-core file concurrency', async () => {
  const raw: unknown = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(typeof raw === 'object' && raw !== null && 'scripts' in raw);
  const scripts = raw.scripts;
  assert.ok(typeof scripts === 'object' && scripts !== null && 'test' in scripts && 'check' in scripts);
  assert.equal(scripts.test, 'node --import ./scripts/test-env.ts --test --test-concurrency=2 --test-reporter=spec '
    + '"scripts/**/*.test.ts" "agent/tests/**/*.test.ts" "desktop/tests/**/*.test.ts" && npm test -w client');
  assert.equal(scripts.check, 'npm run lint && npm run typecheck && npm test');
});
