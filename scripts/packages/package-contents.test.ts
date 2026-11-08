// 服务包里放什么（《优化清单》第 1 条，11-07 定）：服务器上只放打包好的发布版，不放部署脚本、构建工具和写自己代码的开发技能；
// 维护入口 maint.ts 随包走（服务器上从 /opt/plasticine/current/scripts/maint.ts 跑）。

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { INCLUDED_PATHS } from './package-contents.ts';

const REPO = fileURLToPath(new URL('../..', import.meta.url));

test('包里的路径都在仓库里（git archive 认不得的路径会让打包失败）', () => {
  for (const path of INCLUDED_PATHS) {
    assert.ok(existsSync(join(REPO, path)), path);
  }
});

test('包里没有开发技能、部署和发布脚本；有维护入口', () => {
  const forbidden = [/^agent\/skills/, /^scripts$/, /^scripts\/(deploy|ship|github|cutover|preflight)/, /^\.github/];
  for (const path of INCLUDED_PATHS) {
    assert.equal(forbidden.some((pattern) => pattern.test(path)), false, path);
  }
  assert.ok(INCLUDED_PATHS.includes('scripts/maint.ts'));
});
