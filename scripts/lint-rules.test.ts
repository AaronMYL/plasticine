import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LONG_FILES_ALLOWED, MAX_CSS_LINES, MAX_FILE_LINES, MAX_LINE_WIDTH, isMilestoneName, isTestFile, lintSource,
  visibleWidth,
} from './lint-rules.ts';

const rulesOf = (source: string, checkCode = true) => lintSource(source, { checkCode }).map((f) => f.rule);

test('中文按字数算宽度，不按 UTF-16 单元', () => {
  assert.equal(visibleWidth('今日'), 2);
  assert.equal(visibleWidth('a😀b'), 3);
});

test('超过 120 字的行报 line-width，正好 120 不报', () => {
  assert.deepEqual(rulesOf('x'.repeat(MAX_LINE_WIDTH)), []);
  assert.deepEqual(rulesOf('x'.repeat(MAX_LINE_WIDTH + 1)), ['line-width']);
});

test('格式和写法都算错误（11-15 起）：行宽、any、空 catch 违反了 lint 不过', () => {
  const severity = (source: string) => lintSource(source, { checkCode: true }).map((f) => [f.rule, f.severity]);
  assert.deepEqual(severity('x'.repeat(MAX_LINE_WIDTH + 1)), [['line-width', 'error']]);
  assert.deepEqual(severity(`let a: ${'an' + 'y'} = 1;`), [['no-any', 'error']]);
  assert.deepEqual(severity('try { run(); } catch {}'), [['empty-catch', 'error']]);
});

test('源码超过 500 行：登记过「只干一件事」的文件只提醒，没登记的算错误；测试文件不限长度', () => {
  assert.equal(MAX_FILE_LINES, 500);
  const long = 'a\n'.repeat(MAX_FILE_LINES + 1);
  const listed = Object.keys(LONG_FILES_ALLOWED)[0] ?? '';
  assert.deepEqual(lintSource(long, { checkCode: false, path: 'agent/src/x/new-file.ts' })
    .map((f) => [f.rule, f.severity]), [['file-length', 'error']]);
  assert.deepEqual(lintSource(long, { checkCode: false, path: listed })
    .map((f) => [f.rule, f.severity]), [['file-length', 'warning']]);
  assert.deepEqual(lintSource(long, { checkCode: false, isTest: true }), []);
  // 别的仓库（私有仓库）自己登记的：走 lint.ts 读到的 scripts/lint-local.json，原因从 longReason 传进来
  assert.deepEqual(lintSource(long, { checkCode: false, path: 'scripts/own.ts', longReason: '只能是一个文件' })
    .map((f) => [f.rule, f.severity]), [['file-length', 'warning']]);
  // CSS 一行一条声明，上限 800
  const css = (lines: number) => lintSource('a {}\n'.repeat(lines), { checkCode: false, isCss: true, path: 'x.css' });
  assert.deepEqual(css(MAX_CSS_LINES), []);
  assert.deepEqual(css(MAX_CSS_LINES + 1).map((f) => f.rule), ['file-length']);
  assert.ok(isTestFile('agent/tests/model/helpers.ts'));
  assert.ok(isTestFile('scripts\\copy\\copy.test.ts'));
  assert.ok(!isTestFile('agent/src/state/object-store.ts'));
  for (const [path, reason] of Object.entries(LONG_FILES_ALLOWED)) {
    assert.ok(reason.length >= 6, `${path} 要写清为什么可以超过 500 行`);
  }
});

test('一行一个语句：分号后面同一行还有语句就报；只有一个语句的短块、for 头、类型成员不报', () => {
  assert.deepEqual(rulesOf('if (x) { a(); b(); }'), ['one-statement']);
  assert.deepEqual(rulesOf('let a = 1; let b = 2;'), ['one-statement']);
  assert.deepEqual(rulesOf("switch (x) {\n  case 'a': run(); break;\n}"), ['one-statement']);
  assert.deepEqual(rulesOf('if (x) { return; }'), []);
  assert.deepEqual(rulesOf('if (x) { a(); } else { b(); }'), []);
  assert.deepEqual(rulesOf('for (let i = 0; i < n; i += 1) { run(i); }'), []);
  assert.deepEqual(rulesOf('interface P { a: string; b?: number; readonly c: boolean }'), []);
  assert.deepEqual(rulesOf('interface W { ack(sequence: number): Promise<void>; close?(): void; end(): void }'), []);
  assert.deepEqual(rulesOf('const f = (p: { a: string; b: number }): void => { use(p); };'), []);
  assert.deepEqual(rulesOf('const text = `${a};${b}`; // 模板里的分号不算'), []);
  assert.deepEqual(rulesOf("const s = 'a; b';"), []);
});

test('三元最多套两层：第三层报一次；可选链、??、可选参数、条件类型不算', () => {
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

test('测试不许无条件跳过：.skip / .only / .todo 和不带原因的 skip: 报；带条件和原因的不报；源码里不查', () => {
  const inTest = (source: string) => lintSource(source, { checkCode: true, isTest: true }).map((f) => f.rule);
  assert.deepEqual(inTest("test.skip('以后再说', () => {});"), ['no-skipped-test']);
  // 拆开写：推送前的扫描（scan-tests.ts）不许测试里出现这个词后面跟括号
  assert.deepEqual(inTest(`describe.${'on' + 'ly'}('一组', () => {});`), ['no-skipped-test']);
  assert.deepEqual(inTest("it.todo('还没写');"), ['no-skipped-test']);
  assert.deepEqual(inTest("test('名字', { skip: true }, () => {});"), ['no-skipped-test']);
  assert.deepEqual(inTest("test('名字', { skip: !hasTool }, () => {});"), ['no-skipped-test']);
  assert.deepEqual(inTest("test('名字', { skip: hasTool ? false : '这台机器没有这个工具' }, () => {});"), []);
  assert.deepEqual(inTest('assert.deepEqual(counts, { all: 5, todo: 4, done: 1 });'), []);
  assert.deepEqual(rulesOf("test.skip('源码文件里不查', () => {});"), []);
  assert.deepEqual(inTest('queue.skip(3);'), []);
});

test('CSS 一行一条声明：挤了两条、或一行两个花括号块就报；一条声明的短规则、括号里的分号不报', () => {
  const css = (source: string) => lintSource(source, { checkCode: false, isCss: true }).map((f) => f.rule);
  assert.deepEqual(css('.a { color: red; margin: 0; }'), ['css-one-declaration']);
  assert.deepEqual(css('.a {\n  color: red; margin: 0;\n}'), ['css-one-declaration']);
  assert.deepEqual(css('@media (min-width: 600px) { .a { color: red; } }'), ['css-one-declaration']);
  assert.deepEqual(css('.a {\n  color: red;\n  margin: 0; }'), ['css-one-declaration']);
  assert.deepEqual(css('.a { color: red;\n  margin: 0;\n}'), ['css-one-declaration']);
  assert.deepEqual(css('.a { color: red; }'), []);
  assert.deepEqual(css('.a { color: red }'), []);
  assert.deepEqual(css('.a {\n  background: url("data:image/svg+xml;utf8,<svg/>");\n}'), []);
  assert.deepEqual(css('/* a: b; c: d; */\n.a:hover { color: red; }'), []);
});

test('CSS 收尾的花括号和开头那一行对齐：缩进不对就报；嵌在 @media 里的照它自己那一层算', () => {
  const css = (source: string) => lintSource(source, { checkCode: false, isCss: true }).map((f) => f.rule);
  assert.deepEqual(css('.a {\n  color: red;\n  }'), ['css-brace-indent']);
  assert.deepEqual(css('.a {\n  color: red;\n}'), []);
  assert.deepEqual(css('@media (min-width: 600px) {\n  .a {\n    color: red;\n  }\n}'), []);
  assert.deepEqual(css('@media (min-width: 600px) {\n  .a {\n    color: red;\n}\n}'), ['css-brace-indent']);
  assert.deepEqual(css('.a,\n  .b {\n  color: red;\n}'), []);
  assert.deepEqual(css('.a,\n  .b {\n  color: red;\n  }'), ['css-brace-indent']);
});

test('文件名不用里程碑、批次：m5b-…、第13批-… 报，普通名字不报', () => {
  assert.ok(isMilestoneName('agent/src/app/m5b-services.ts'));
  assert.ok(isMilestoneName('client/src/state/m4-action-requests.ts'));
  assert.ok(isMilestoneName('scripts/browser/第13批-shots.ts'));
  assert.ok(!isMilestoneName('agent/src/state/migrations/0052-mail-bodies.ts'));
  assert.ok(!isMilestoneName('agent/src/books/format/mobi.ts'));
  assert.ok(!isMilestoneName('client/src/views/models/models-page.tsx'));
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
  assert.deepEqual(rulesOf(`const ${ANY} = 1;\nconst half = total / 2 / count;`), []);
  assert.deepEqual(rulesOf(`f(${ANY});\ng(a, ${ANY});\nconst n = ${ANY};\nconst xs = [${ANY}];`), []);
});

test('对象字面量、比较、位运算里名叫 any 的值不误报；函数类型的返回值照样拦', () => {
  assert.deepEqual(rulesOf(`const obj = { value: ${ANY} };\nconst lt = a < ${ANY};\nconst bits = x | ${ANY};`), []);
  assert.deepEqual(rulesOf(`const pick = c ? ${ANY} : other;\nconst g = () => ${ANY};`), []);
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
