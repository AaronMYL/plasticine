import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('全测保留服务端、脚本、桌面壳的完整发现范围及客户端串接，仅将文件并发设为双核上限', async () => {
  const raw: unknown = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(typeof raw === 'object' && raw !== null && 'scripts' in raw);
  const scripts = raw.scripts;
  assert.ok(typeof scripts === 'object' && scripts !== null && 'test' in scripts && 'check' in scripts);
  assert.equal(scripts.test, 'node --test --test-concurrency=2 --test-reporter=spec '
    + '"scripts/**/*.test.ts" "agent/tests/**/*.test.ts" "desktop/tests/**/*.test.ts" && npm test -w client');
  assert.equal(scripts.check, 'npm run lint && npm run typecheck && npm test');
});
