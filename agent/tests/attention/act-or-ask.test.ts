import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import {
  ACT_OR_ASK_PROMPT, ASK_BASES, ASK_BASIS_LABELS, basisShapeProblem, HARD_LINES,
} from '../../shared/act-or-ask.ts';
import { ASK_PURPOSE_LINES, ASK_PURPOSES, type AskPurpose } from '../../shared/state.ts';
import { AttentionError, type RaiseAsk } from '../../src/attention/index.ts';
import { harness, type Harness } from './desk-harness.ts';

let h: Harness;

beforeEach(() => {
  h = harness();
});

afterEach(() => {
  h.close();
});

function raise(input: Partial<RaiseAsk> & Pick<RaiseAsk, 'purpose'>) {
  return h.desk.commit((changes) => h.desk.raise(changes, {
    kind: 'decide', question: '这件怎么办？', options: [{ id: 'a', label: '这样', recommended: true },
      { id: 'b', label: '那样' }], ...input,
  }));
}

test('judgment boundary is defined once (5 practices + 5 hard lines) and included in line prompt', () => {
  assert.deepEqual([...HARD_LINES], ['花钱', '以本人名义对外答应或发出', '删除和其他做了就撤不回的', '权限变化',
    '必须本人做的']);
  for (const line of HARD_LINES) {
    assert.ok(ACT_OR_ASK_PROMPT.includes(line), line);
  }
  for (const phrase of ['明说过的', '推出来的', '推荐项放第一个', '几种都说得通', '资料里没有', '先去查']) {
    assert.ok(ACT_OR_ASK_PROMPT.includes(phrase), phrase);
  }
  const prompt = readFileSync(join(import.meta.dirname, '../../src/lines/prompt.ts'), 'utf8');
  assert.ok(prompt.includes('ACT_OR_ASK_PROMPT'), '主线和后台线共用的系统提示里放整段');
});

test('all ask-vs-act guidance references single boundary instead of repeating ad-hoc rules', () => {
  const files = ['projects/tools.ts', 'lines/prompt.ts'];
  const src = join(import.meta.dirname, '../../src');
  for (const file of files) {
    const text = readFileSync(join(src, file), 'utf8');
    assert.ok(text.includes('ACT_OR_ASK'), `${file} 引用那条线`);
    for (const old of ['拿不准就问', '拿不准就用 ask_user', '拿不准哪个项目先 ask_user', '只在真正需要用户时问']) {
      assert.ok(!text.includes(old), `${file} 还留着「${old}」`);
    }
  }
});

test('four bases have plain labels; inferred needs recommendation, multi-choice needs >=2 options', () => {
  assert.deepEqual([...ASK_BASES], ['inferred', 'options', 'missing', 'hard_line']);
  assert.deepEqual(Object.values(ASK_BASIS_LABELS), ['推出来的', '有几种可能', '资料里没有', '硬线']);
  const one = [{ id: 'a', recommended: true }];
  assert.equal(basisShapeProblem('inferred', one), null);
  assert.match(basisShapeProblem('inferred', [{ id: 'a' }, { id: 'b' }]) ?? '', /推荐/);
  assert.match(basisShapeProblem('options', one) ?? '', /两个/);
  assert.equal(basisShapeProblem('options', [{ id: 'a' }, { id: 'b' }]), null);
  assert.equal(basisShapeProblem('missing', []), null, '资料里没有的可以只写一句');
  assert.equal(basisShapeProblem('hard_line', []), null);
});

test('existing card types are categorized in table separating hard-line vs confidence-based', () => {
  assert.deepEqual(Object.keys(ASK_PURPOSE_LINES).sort(), [...ASK_PURPOSES].sort());
  const of = (line: string) => ASK_PURPOSES.filter((purpose) => ASK_PURPOSE_LINES[purpose].line === line).sort();
  assert.deepEqual(of('retired'), []);
  assert.deepEqual(of('hard_line'), ['backup_restore', 'device_action', 'line_approval', 'loop_offer',
    'network_task']);
  assert.deepEqual(of('by_confidence'), ['line_question', 'money_confirmation', 'network_reply',
    'subscription_schedule']);
  for (const purpose of of('hard_line')) {
    assert.equal(ASK_PURPOSE_LINES[purpose].basis, 'hard_line', purpose);
  }
});

test('hard-line cards always record hard-line basis; confidence cards use caller basis or default', () => {
  for (const purpose of ['device_action', 'backup_restore', 'network_task', 'line_approval'] as AskPurpose[]) {
    assert.equal(raise({ purpose, actionId: `hard:${purpose}` }).basis, 'hard_line', purpose);
  }
  assert.throws(() => raise({ purpose: 'device_action', basis: 'inferred', actionId: 'wrong' }),
    (error: unknown) => error instanceof AttentionError && error.code === 'invalid_ask');
  assert.equal(raise({ purpose: 'line_question', basis: 'options', actionId: 'c1' }).basis, 'options');
  assert.equal(raise({ purpose: 'line_question', basis: 'hard_line', actionId: 'c2' }).basis, 'hard_line',
    '看把握的卡碰上硬线（要花钱）也记硬线');
  assert.equal(raise({ purpose: 'line_question', options: [], actionId: 'q1' }).basis, 'missing');
  assert.equal(raise({ purpose: 'money_confirmation', actionId: 'm1' }).basis, 'missing');
});
