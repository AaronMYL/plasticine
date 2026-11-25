import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LONG_FILES_ALLOWED, MAX_CSS_LINES, MAX_FILE_LINES, MAX_LINE_WIDTH, isMilestoneName, isTestFile, lintSource,
  visibleWidth,
} from './lint-rules.ts';

const rulesOf = (source: string, checkCode = true) => lintSource(source, { checkCode }).map((f) => f.rule);

test('counts Unicode code points rather than UTF-16 code units', () => {
  assert.equal(visibleWidth('今日'), 2);
  assert.equal(visibleWidth('a😀b'), 3);
});

test('reports line-width above 120 characters and allows exactly 120', () => {
  assert.deepEqual(rulesOf('x'.repeat(MAX_LINE_WIDTH)), []);
  assert.deepEqual(rulesOf('x'.repeat(MAX_LINE_WIDTH + 1)), ['line-width']);
});

test('treats line-width, no-any, and empty-catch violations as hard errors', () => {
  const severity = (source: string) => lintSource(source, { checkCode: true }).map((f) => [f.rule, f.severity]);
  assert.deepEqual(severity('x'.repeat(MAX_LINE_WIDTH + 1)), [['line-width', 'error']]);
  assert.deepEqual(severity(`let a: ${'an' + 'y'} = 1;`), [['no-any', 'error']]);
  assert.deepEqual(severity('try { run(); } catch {}'), [['empty-catch', 'error']]);
});

test('enforces 500-line soft limit with registered warnings and exempts test files', () => {
  assert.equal(MAX_FILE_LINES, 500);
  const long = 'a\n'.repeat(MAX_FILE_LINES + 1);
  const listed = Object.keys(LONG_FILES_ALLOWED)[0] ?? '';
  assert.deepEqual(lintSource(long, { checkCode: false, path: 'agent/src/x/new-file.ts' })
    .map((f) => [f.rule, f.severity]), [['file-length', 'error']]);
  assert.deepEqual(lintSource(long, { checkCode: false, path: listed })
    .map((f) => [f.rule, f.severity]), [['file-length', 'warning']]);
  assert.deepEqual(lintSource(long, { checkCode: false, isTest: true }), []);
  assert.deepEqual(lintSource(long, { checkCode: false, path: 'scripts/own.ts', longReason: 'Single-file daemon' })
    .map((f) => [f.rule, f.severity]), [['file-length', 'warning']]);
  const css = (lines: number) => lintSource('a {}\n'.repeat(lines), { checkCode: false, isCss: true, path: 'x.css' });
  assert.deepEqual(css(MAX_CSS_LINES), []);
  assert.deepEqual(css(MAX_CSS_LINES + 1).map((f) => f.rule), ['file-length']);
  assert.ok(isTestFile('agent/tests/model/helpers.ts'));
  assert.ok(isTestFile('scripts\\copy\\copy.test.ts'));
  assert.ok(!isTestFile('agent/src/state/object-store.ts'));
  for (const [path, reason] of Object.entries(LONG_FILES_ALLOWED)) {
    assert.ok(reason.length >= 6, `${path} must document why it exceeds 500 lines`);
  }
});

test('enforces one statement per line while allowing single-statement blocks, for headers, and type members', () => {
  assert.deepEqual(rulesOf('if (x) { a(); b(); }'), ['one-statement']);
  assert.deepEqual(rulesOf('let a = 1; let b = 2;'), ['one-statement']);
  assert.deepEqual(rulesOf("switch (x) {\n  case 'a': run(); break;\n}"), ['one-statement']);
  assert.deepEqual(rulesOf('if (x) { return; }'), []);
  assert.deepEqual(rulesOf('if (x) { a(); } else { b(); }'), []);
  assert.deepEqual(rulesOf('for (let i = 0; i < n; i += 1) { run(i); }'), []);
  assert.deepEqual(rulesOf('interface P { a: string; b?: number; readonly c: boolean }'), []);
  assert.deepEqual(rulesOf('interface W { ack(sequence: number): Promise<void>; close?(): void; end(): void }'), []);
  assert.deepEqual(rulesOf('const f = (p: { a: string; b: number }): void => { use(p); };'), []);
  assert.deepEqual(rulesOf('const text = `${a};${b}`;'), []);
  assert.deepEqual(rulesOf("const s = 'a; b';"), []);
});

test('caps ternary nesting at two levels while ignoring optional chaining, ??, and conditional types', () => {
  assert.deepEqual(rulesOf('const v = a ? 1 : b ? 2 : 3;'), []);
  assert.deepEqual(rulesOf('const v = a ? 1 : b ? 2 : c ? 3 : 4;'), ['nested-ternary']);
  assert.deepEqual(rulesOf('const v = a ? 1 : (b ? 2 : (c ? 3 : d ? 4 : 5));'), ['nested-ternary']);
  assert.deepEqual(rulesOf('const v = a ? (b ? (c ? 1 : 2) : 3) : 4;'), ['nested-ternary']);
  assert.deepEqual(rulesOf('const v = a ? f(b ? 1 : 2, c ? 3 : 4) : g(d ? 5 : 6);'), []);
  assert.deepEqual(rulesOf('const v = [a ? 1 : 2, b ? 1 : 2, c ? 1 : 2];'), []);
  assert.deepEqual(rulesOf('const v = a?.b ?? c?.[0] ?? d?.(1);'), []);
  assert.deepEqual(rulesOf('function f(a?: string, b?: number, c?: boolean): void { use(a, b, c); }'), []);
  const conditionalType = "type T<X> = X extends string ? 'a' : X extends number ? 'b' "
    + ": X extends boolean ? 'c' : 'd';";
  assert.deepEqual(rulesOf(conditionalType), []);
  assert.deepEqual(rulesOf('const v = a ? `${b ? 1 : 2}` : `${c ? 3 : 4}`;'), []);
  assert.deepEqual(rulesOf("const who = mine ? (ai ? 'my_ai' : 'me') : (ai ? 'their_ai' : 'them');"), []);
  assert.deepEqual(rulesOf('const v = a ? b ? 1 : 2 : c ? 3 : 4;'), []);
  assert.deepEqual(rulesOf('const html = `${a ? 1 : 2}${b ? 1 : 2}${c ? 1 : 2}${d ? 1 : 2}`;'), []);
  assert.deepEqual(rulesOf('const row = [on ? <Row checked={on} /> : null, a ? 1 : null, b ? 2 : null];'), []);
});

test('rejects unconditional test skips while allowing conditional skips with an English reason', () => {
  const inTest = (source: string) => lintSource(source, { checkCode: true, isTest: true }).map((f) => f.rule);
  assert.deepEqual(inTest("test.skip('later', () => {});"), ['no-skipped-test']);
  assert.deepEqual(inTest(`describe.${'on' + 'ly'}('group', () => {});`), ['no-skipped-test']);
  assert.deepEqual(inTest("it.todo('pending');"), ['no-skipped-test']);
  assert.deepEqual(inTest("test('name', { skip: true }, () => {});"), ['no-skipped-test']);
  assert.deepEqual(inTest("test('name', { skip: !hasTool }, () => {});"), ['no-skipped-test']);
  assert.deepEqual(inTest("test('name', { skip: hasTool ? false : 'tool not installed' }, () => {});"), []);
  assert.deepEqual(inTest('assert.deepEqual(counts, { all: 5, todo: 4, done: 1 });'), []);
  assert.deepEqual(rulesOf("test.skip('ignored outside test files', () => {});"), []);
  assert.deepEqual(inTest('queue.skip(3);'), []);
});

test('rejects Chinese test and suite titles without flagging regex.test or UI assertions', () => {
  const inTest = (source: string) => lintSource(source, { checkCode: true, isTest: true }).map((f) => f.rule);
  assert.deepEqual(inTest("test('中文测试标题', () => {});"), ['no-cjk-test-title']);
  assert.deepEqual(inTest("describe.concurrent('分组标题', () => { it('works', () => {}); });"), ['no-cjk-test-title']);
  assert.deepEqual(inTest("test('renders Chinese UI copy', () => { assert.ok(/保存/.test('保存')); });"), []);
});

test('enforces one declaration per CSS line while allowing single-declaration short rules', () => {
  const css = (source: string) => lintSource(source, { checkCode: false, isCss: true }).map((f) => f.rule);
  assert.deepEqual(css('.a { color: red; margin: 0; }'), ['css-one-declaration']);
  assert.deepEqual(css('.a {\n  color: red; margin: 0;\n}'), ['css-one-declaration']);
  assert.deepEqual(css('@media (min-width: 600px) { .a { color: red; } }'), ['css-one-declaration']);
  assert.deepEqual(css('.a {\n  color: red;\n  margin: 0; }'), ['css-one-declaration']);
  assert.deepEqual(css('.a { color: red;\n  margin: 0;\n}'), ['css-one-declaration']);
  assert.deepEqual(css('.a { color: red; }'), []);
  assert.deepEqual(css('.a { color: red }'), []);
  assert.deepEqual(css('.a {\n  background: url("data:image/svg+xml;utf8,<svg/>");\n}'), []);
  assert.deepEqual(css('/** Section header: a: b; c: d; */\n.a:hover { color: red; }'), []);
});

test('enforces closing CSS brace alignment across top-level and nested @media blocks', () => {
  const css = (source: string) => lintSource(source, { checkCode: false, isCss: true }).map((f) => f.rule);
  assert.deepEqual(css('.a {\n  color: red;\n  }'), ['css-brace-indent']);
  assert.deepEqual(css('.a {\n  color: red;\n}'), []);
  assert.deepEqual(css('@media (min-width: 600px) {\n  .a {\n    color: red;\n  }\n}'), []);
  assert.deepEqual(css('@media (min-width: 600px) {\n  .a {\n    color: red;\n}\n}'), ['css-brace-indent']);
  assert.deepEqual(css('.a,\n  .b {\n  color: red;\n}'), []);
  assert.deepEqual(css('.a,\n  .b {\n  color: red;\n  }'), ['css-brace-indent']);
});

test('rejects milestone or batch prefixes in file names', () => {
  assert.ok(isMilestoneName('agent/src/app/m5b-services.ts'));
  assert.ok(isMilestoneName('client/src/state/m4-action-requests.ts'));
  assert.ok(isMilestoneName('scripts/browser/batch-13-shots.ts'));
  assert.ok(!isMilestoneName('agent/src/state/migrations/0052-mail-bodies.ts'));
  assert.ok(!isMilestoneName('agent/src/books/format/mobi.ts'));
  assert.ok(!isMilestoneName('client/src/views/models/models-page.tsx'));
});

test('reports file-length when exceeding MAX_FILE_LINES', () => {
  const ok = 'a\n'.repeat(MAX_FILE_LINES);
  assert.deepEqual(rulesOf(ok), []);
  assert.deepEqual(rulesOf(ok + 'a\n'), ['file-length']);
});

const CATCH = 'catch';
const ANY = 'any';

test('rejects empty catch blocks and allows handled catches', () => {
  assert.deepEqual(rulesOf(`try { f(); } ${CATCH} {}`), ['empty-catch']);
  assert.deepEqual(rulesOf(`try { f(); } ${CATCH} (error) { }`), ['empty-catch']);
  assert.deepEqual(rulesOf(`try { f(); } ${CATCH} (error) { log(error); }`), []);
});

test('ignores object and class methods named catch', () => {
  assert.deepEqual(rulesOf(`const api = { ${CATCH}() {} };`), []);
  assert.deepEqual(rulesOf(`class Api { read() {} ${CATCH}() {} }`), []);
});

test('distinguishes member names and comparisons named any from return type annotations', () => {
  assert.deepEqual(rulesOf(`interface Box { ${ANY}: string; ${ANY}?: string }`), []);
  assert.deepEqual(rulesOf(`const ok = 0 < ${ANY} && ${ANY} > -1;`), []);
  assert.deepEqual(rulesOf(`const ok = x < ${ANY} && ${ANY} > -1;`), []);
  assert.deepEqual(rulesOf(`function outer() { function inner(): ${ANY} {} }`), ['no-any']);
  assert.deepEqual(rulesOf(`const box = { read(): ${ANY} {} };`), ['no-any']);
});

test('reports multi-line empty catch on the catch keyword line', () => {
  const findings = lintSource(`try {\n  f();\n} ${CATCH} (error) {\n\n}\n`, { checkCode: true });
  assert.deepEqual(findings.map((f) => [f.rule, f.line]), [['empty-catch', 3]]);
});

test('rejects explicit any annotations without matching substrings like company or many', () => {
  assert.deepEqual(rulesOf(`let a: ${ANY} = 1;`), ['no-any']);
  assert.deepEqual(rulesOf(`const b = c as ${ANY};`), ['no-any']);
  assert.deepEqual(rulesOf(`type T = ${ANY};`), ['no-any']);
  assert.deepEqual(rulesOf(`let u: string | ${ANY};`), ['no-any']);
  assert.deepEqual(rulesOf(`const xs: ${ANY}[] = [];`), ['no-any']);
  assert.deepEqual(rulesOf('const company = many;'), []);
});

test('ignores any and catch inside strings, templates, regexes, and JSDoc comments', () => {
  const TICK = '`';
  assert.deepEqual(rulesOf(`const s = '${CATCH} {} and : ${ANY}';`), []);
  assert.deepEqual(rulesOf(`const t = "x: ${ANY}";`), []);
  assert.deepEqual(rulesOf(`const u = ${TICK}x: ${ANY} \${f({ a: 1 })} y${TICK};`), []);
  assert.deepEqual(rulesOf(`const r = /${CATCH}\\s*\\{\\}/g;`), []);
  assert.deepEqual(rulesOf(`/** ${CATCH} {} : ${ANY} */\nconst v = 1;`), []);
});

test('rejects tuple any and catch blocks containing only a comment', () => {
  assert.deepEqual(rulesOf(`type T = [${ANY}];`), ['no-any']);
  assert.deepEqual(rulesOf(`try {\n  f();\n} ${CATCH} {\n  /** Ignored. */\n}`), ['empty-catch']);
});

test('ignores value variables named any and division expressions', () => {
  assert.deepEqual(rulesOf(`const ${ANY} = 1;\nconst half = total / 2 / count;`), []);
  assert.deepEqual(rulesOf(`f(${ANY});\ng(a, ${ANY});\nconst n = ${ANY};\nconst xs = [${ANY}];`), []);
});

test('distinguishes value expressions using any from function return type annotations', () => {
  assert.deepEqual(rulesOf(`const obj = { value: ${ANY} };\nconst lt = a < ${ANY};\nconst bits = x | ${ANY};`), []);
  assert.deepEqual(rulesOf(`const pick = c ? ${ANY} : other;\nconst g = () => ${ANY};`), []);
  assert.deepEqual(rulesOf(`let f: () => ${ANY};`), ['no-any']);
  assert.deepEqual(rulesOf(`function f() { const x: ${ANY} = 1; }`), ['no-any']);
  assert.deepEqual(rulesOf(`if (ok) { let y: ${ANY}; } else { const z = { k: ${ANY} }; }`), ['no-any']);
  assert.deepEqual(rulesOf(`interface Box { value: ${ANY} }`), ['no-any']);
  assert.deepEqual(rulesOf(`type Pick<T = ${ANY}> = T extends string ? ${ANY} : never;`), ['no-any', 'no-any']);
});

test('handles closing braces inside regexes and comments within template interpolations', () => {
  const TICK = '`';
  const source = `const s = ${TICK}\${/[}]/.test(x) ? (y as ${ANY}) : 0 // Invariant: }\n}${TICK};`;
  assert.deepEqual(rulesOf(source), ['no-any']);
});

test('rejects any inside generic type arguments and function type aliases', () => {
  assert.deepEqual(rulesOf(`let r: Record<string, ${ANY}>;`), ['no-any']);
  assert.deepEqual(rulesOf(`function f(): Promise<[string, ${ANY}]> {}`), ['no-any']);
  assert.deepEqual(rulesOf(`type F = (x: string, y: number) => Array<${ANY}>;`), ['no-any']);
});

test('reports accurate line numbers for violations inside template interpolations', () => {
  const TICK = '`';
  const first = `const s = ${TICK}a\n\${(x as ${ANY}).y}${TICK};`;
  const second = `const t = ${TICK}\${(() => { try { f(); } ${CATCH} {} })()}${TICK};`;
  const source = `${first}\n${second}`;
  const findings = lintSource(source, { checkCode: true });
  assert.deepEqual(findings.map((f) => [f.rule, f.line]), [['no-any', 2], ['empty-catch', 3]]);
});

test('enforces comment rules: forbids CJK and inline comments while allowing JSDoc and directives', () => {
  assert.deepEqual(rulesOf('/** Clean English JSDoc. */\nexport const v = 1;'), []);
  assert.deepEqual(rulesOf('// SPDX-License-Identifier: Apache-2.0\nexport const v = 1;'), []);
  assert.deepEqual(rulesOf('// allow-exception: static asset fetch\nexport const v = 1;'), []);
  assert.deepEqual(rulesOf('// Invariant: socket closes asynchronously before drain\nexport const v = 1;'), []);
  assert.deepEqual(rulesOf('// Casual inline comment\nexport const v = 1;'), ['no-inline-comment']);
  assert.deepEqual(rulesOf('/** 中文文档注释 */\nexport const v = 1;'), ['no-cjk-comment']);
  assert.deepEqual(rulesOf('// 中文行内注释\nexport const v = 1;'), ['no-cjk-comment', 'no-inline-comment']);
  assert.deepEqual(
    lintSource('.a { padding: 96px; } /* allow-exception: floating orb clearance */', { checkCode: false, isCss: true })
      .map((f) => f.rule),
    [],
  );
  assert.deepEqual(
    lintSource('/* 样式注释 */\n.a { color: red; }', { checkCode: false, isCss: true }).map((f) => f.rule),
    ['no-cjk-comment', 'no-inline-comment'],
  );
  assert.deepEqual(
    lintSource('# 中文脚本注释\necho ok\n', { checkCode: false, commentStyle: 'hash' }).map((f) => f.rule),
    ['no-cjk-comment'],
  );
  assert.deepEqual(rulesOf(`${CATCH} {}`, false), []);
});
