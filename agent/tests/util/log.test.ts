import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { scan } from '../../../scripts/lint-scan.ts';
import { errorCategory, safeLog } from '../../src/util/log.ts';
import { assertNoPrivateText, captureLogs, PRIVATE_ERROR_TEXT, privateError } from '../safety-helpers.ts';

test('Safe logger outputs controlled fields only, never raw errors or forged types', (context) => {
  const lines = captureLogs(context);
  const error = privateError();
  safeLog('error', 'backup_failed', { category: errorCategory(error), status: 503 });
  error.name = PRIVATE_ERROR_TEXT;
  const fields = {
    category: errorCategory(error), objectId: PRIVATE_ERROR_TEXT, message: error.message, cause: error.cause,
    stack: error.stack, body: PRIVATE_ERROR_TEXT, status: 503,
  };
  safeLog('warn', 'push_failed', fields);
  assert.equal(lines.length, 2);
  assert.match(lines.join('\n'), /backup_failed/);
  assert.match(lines.join('\n'), /503/);
  assertNoPrivateText(lines);
});

test('Scrubs credential-like URL params from logged error messages', (context) => {
  const lines = captureLogs(context);
  const error = new Error('fetch failed: https://news.example.test/feed?token=abc&page=2');
  safeLog('warn', 'feed_source_failed', { category: errorCategory(error), error });
  assert.equal(lines.length, 1);
  assert.equal(lines.join('\n').includes('token=abc'), false);
  assert.match(lines.join('\n'), /news\.example\.test\/feed\?page=2/);
});

test('Safe logger prevents object or non-string error serialization hooks from leaking', (context) => {
  const lines = captureLogs(context);
  const poison = { toString: () => { throw privateError(); } };
  assert.equal(errorCategory(poison), 'UnknownError');
  const getter = Object.defineProperty(privateError(), 'name', { get: () => { throw privateError(); } });
  assert.equal(errorCategory(getter), 'UnknownError');
  Reflect.apply(safeLog, undefined, ['error', PRIVATE_ERROR_TEXT, { category: PRIVATE_ERROR_TEXT }]);
  Reflect.apply(safeLog, undefined, ['log', 'push_failed', privateError()]);
  assertNoPrivateText(lines);
});

function consoleOffsets(source: string): number[] {
  const tokens = scan(source).filter((token) => token.kind !== 'comment');
  return tokens.filter((token, index) => {
    if (token.kind === 'ident' && token.text === 'console') {
      return true;
    }
    const literal = token.text.slice(1, -1);
    return token.kind === 'string' && (literal === 'node:console'
      || (literal === 'console' && ['[', 'from', 'import', '('].includes(tokens[index - 1]?.text ?? '')));
  }).map((token) => token.offset);
}

test('Log guard detects direct, alias, computed, template, import calls; skips comments', () => {
  for (const source of [
    'console.error(error)', "console['warn'](error)", 'const output = console; output.log(error)',
    'globalThis.console.log(error)', "globalThis['console'].warn(error)",
    "import output from 'node:console'", '`${console.log(error)}`',
  ]) {
    assert.ok(consoleOffsets(source).length > 0, source);
  }
  assert.deepEqual(consoleOffsets('// console.log(error)\nconst text = "console.log(error)";'), []);
});

test('Agent source and check scripts access console only via unified logger', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const violations: string[] = [];
  for (const folder of ['src']) {
    const directory = join(root, folder);
    for (const file of readdirSync(directory, { recursive: true, encoding: 'utf8' })) {
      if (!/\.(?:[cm]?[jt]sx?)$/.test(file) || file === 'util/log.ts') {
        continue;
      }
      const path = join(directory, file);
      const source = readFileSync(path, 'utf8');
      for (const offset of consoleOffsets(source)) {
        violations.push(`${relative(root, path)}:${source.slice(0, offset).split('\n').length}`);
      }
    }
  }
  assert.deepEqual(violations, [], '日志必须经 util/log.ts 的白名单输出');
});
