import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_FILE_LINES, MAX_LINE_WIDTH, isTestFile, lintSource, visibleWidth } from './lint-rules.ts';

const rulesOf = (source: string, checkCode = true) => lintSource(source, { checkCode }).map((f) => f.rule);

test('中文按字数算宽度，不按 UTF-16 单元', () => {
  assert.equal(visibleWidth('今日'), 2);
  assert.equal(visibleWidth('a😀b'), 3);
});

test('超过 120 字的行报 line-width，正好 120 不报', () => {
  assert.deepEqual(rulesOf('x'.repeat(MAX_LINE_WIDTH)), []);
  assert.deepEqual(rulesOf('x'.repeat(MAX_LINE_WIDTH + 1)), ['line-width']);
});

test('格式和类型写法只提醒（第 98 条）：行宽、any 不算错误；吞错误的空 catch 仍是错误', () => {
  const severity = (source: string) => lintSource(source, { checkCode: true }).map((f) => [f.rule, f.severity]);
  assert.deepEqual(severity('x'.repeat(MAX_LINE_WIDTH + 1)), [['line-width', 'warning']]);
  assert.deepEqual(severity(`let a: ${'an' + 'y'} = 1;`), [['no-any', 'warning']]);
  assert.deepEqual(severity('try { run(); } catch {}'), [['empty-catch', 'error']]);
});

test('源码超过 500 行只是提醒，不算错误；测试文件不限长度', () => {
  assert.equal(MAX_FILE_LINES, 500);
  const long = 'a\n'.repeat(MAX_FILE_LINES + 1);
  const findings = lintSource(long, { checkCode: false });
  assert.deepEqual(findings.map((f) => [f.rule, f.severity]), [['file-length', 'warning']]);
  assert.deepEqual(lintSource(long, { checkCode: false, isTest: true }), []);
  assert.ok(isTestFile('agent/tests/model/helpers.ts'));
  assert.ok(isTestFile('scripts\\copy\\copy.test.ts'));
  assert.ok(!isTestFile('agent/src/state/object-store.ts'));
});

test('超过上限的文件报 file-length', () => {
  const ok = 'a\n'.repeat(MAX_FILE_LINES);
  assert.deepEqual(rulesOf(ok), []);
  assert.deepEqual(rulesOf(ok + 'a\n'), ['file-length']);
});

// The offending snippets are assembled from pieces so this test file does not trip the linter itself.
const CATCH = 'catch';
const ANY = 'any';

test('空的 catch 会被拦下，有处理的不拦', () => {
  assert.deepEqual(rulesOf(`try { f(); } ${CATCH} {}`), ['empty-catch']);
  assert.deepEqual(rulesOf(`try { f(); } ${CATCH} (error) { }`), ['empty-catch']);
  assert.deepEqual(rulesOf(`try { f(); } ${CATCH} (error) { log(error); }`), []);
});

test('叫 catch 的对象和类方法不算 catch 子句', () => {
  assert.deepEqual(rulesOf(`const api = { ${CATCH}() {} };`), []);
  assert.deepEqual(rulesOf(`class Api { read() {} ${CATCH}() {} }`), []);
});

test('any 成员名和比较不误报，嵌套函数和方法返回的 any 要报', () => {
  assert.deepEqual(rulesOf(`interface Box { ${ANY}: string; ${ANY}?: string }`), []);
  assert.deepEqual(rulesOf(`const ok = 0 < ${ANY} && ${ANY} > -1;`), []);
  assert.deepEqual(rulesOf(`const ok = x < ${ANY} && ${ANY} > -1;`), []);
  assert.deepEqual(rulesOf(`function outer() { function inner(): ${ANY} {} }`), ['no-any']);
  assert.deepEqual(rulesOf(`const box = { read(): ${ANY} {} };`), ['no-any']);
});

test('跨行的空 catch 也会被拦下，并报在 catch 那一行', () => {
  const findings = lintSource(`try {\n  f();\n} ${CATCH} (error) {\n\n}\n`, { checkCode: true });
  assert.deepEqual(findings.map((f) => [f.rule, f.line]), [['empty-catch', 3]]);
});

test('显式 any 被拦下，单词里含 any 的不拦', () => {
  assert.deepEqual(rulesOf(`let a: ${ANY} = 1;`), ['no-any']);
  assert.deepEqual(rulesOf(`const b = c as ${ANY};`), ['no-any']);
  assert.deepEqual(rulesOf(`type T = ${ANY};`), ['no-any']);
  assert.deepEqual(rulesOf(`let u: string | ${ANY};`), ['no-any']);
  assert.deepEqual(rulesOf(`const xs: ${ANY}[] = [];`), ['no-any']);
  assert.deepEqual(rulesOf('const company = many;'), []);
});

test('字符串、模板字符串、正则和注释里的 any、catch 不算', () => {
  const TICK = '`';
  assert.deepEqual(rulesOf(`const s = '${CATCH} {} and : ${ANY}';`), []);
  assert.deepEqual(rulesOf(`const t = "x: ${ANY}";`), []);
  assert.deepEqual(rulesOf(`const u = ${TICK}x: ${ANY} \${f({ a: 1 })} y${TICK};`), []);
  assert.deepEqual(rulesOf(`const r = /${CATCH}\\s*\\{\\}/g;`), []);
  assert.deepEqual(rulesOf(`/* ${CATCH} {} : ${ANY} */ const v = 1;`), []);
});

test('元组里的 any 和只写了注释的空 catch 都会被拦下', () => {
  assert.deepEqual(rulesOf(`type T = [${ANY}];`), ['no-any']);
  assert.deepEqual(rulesOf(`try { f(); } ${CATCH} { /* 先不管 */ }`), ['empty-catch']);
});

test('变量名叫 any 或除法不会误报', () => {
  assert.deepEqual(rulesOf(`const ${ANY} = 1; const half = total / 2 / count;`), []);
  assert.deepEqual(rulesOf(`f(${ANY}); g(a, ${ANY}); const n = ${ANY}; const xs = [${ANY}];`), []);
});

test('对象字面量、比较、位运算里名叫 any 的值不误报；函数类型的返回值照样拦', () => {
  assert.deepEqual(rulesOf(`const obj = { value: ${ANY} }; const lt = a < ${ANY}; const bits = x | ${ANY};`), []);
  assert.deepEqual(rulesOf(`const pick = c ? ${ANY} : other; const g = () => ${ANY};`), []);
  assert.deepEqual(rulesOf(`let f: () => ${ANY};`), ['no-any']);
  assert.deepEqual(rulesOf(`function f() { const x: ${ANY} = 1; }`), ['no-any']);
  assert.deepEqual(rulesOf(`if (ok) { let y: ${ANY}; } else { const z = { k: ${ANY} }; }`), ['no-any']);
  assert.deepEqual(rulesOf(`interface Box { value: ${ANY} }`), ['no-any']);
  assert.deepEqual(rulesOf(`type Pick<T = ${ANY}> = T extends string ? ${ANY} : never;`), ['no-any', 'no-any']);
});

test('模板插值里的正则和注释含 } 也不会提前结束插值', () => {
  const TICK = '`';
  const source = `const s = ${TICK}\${/[}]/.test(x) ? (y as ${ANY}) : 0 // }\n}${TICK};`;
  assert.deepEqual(rulesOf(source), ['no-any']);
});

test('类型参数和类型别名里的 any 照样拦', () => {
  assert.deepEqual(rulesOf(`let r: Record<string, ${ANY}>;`), ['no-any']);
  assert.deepEqual(rulesOf(`function f(): Promise<[string, ${ANY}]> {}`), ['no-any']);
  assert.deepEqual(rulesOf(`type F = (x: string, y: number) => Array<${ANY}>;`), ['no-any']);
});

test('模板插值里的代码也查：as any 和空 catch 都拦，位置是真实行号', () => {
  const TICK = '`';
  const first = `const s = ${TICK}a\n\${(x as ${ANY}).y}${TICK};`;
  const second = `const t = ${TICK}\${(() => { try { f(); } ${CATCH} {} })()}${TICK};`;
  const source = `${first}\n${second}`;
  const findings = lintSource(source, { checkCode: true });
  assert.deepEqual(findings.map((f) => [f.rule, f.line]), [['no-any', 2], ['empty-catch', 3]]);
});

test('注释行和非代码文件只查宽度', () => {
  assert.deepEqual(rulesOf(`// ${CATCH} {} 只是举例`), []);
  assert.deepEqual(rulesOf(`${CATCH} {}`, false), []);
});
