import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendToSection, diffSoul, MAIN_SOUL_OPENING, mateRoleOf, mateSoulOpening, soulChangeCount,
  soulFirstParagraph, soulKeptShare } from '../../shared/soul-text.ts';

test('Teammate header formats \'You are my ...\'; first paragraph strips headings/breaks', () => {
  assert.equal(mateSoulOpening('求职顾问', '简历、投递和面试准备。'), '你是我的求职顾问：简历、投递和面试准备。');
  assert.equal(mateSoulOpening('设计师', ''), '你是我的设计师。');
  assert.equal(soulFirstParagraph('# 我\n你是我的求职顾问：\n管简历。\n\n## 说话\n- 先说结论'), '我 你是我的求职顾问： 管简历。');
  assert.equal(soulFirstParagraph(MAIN_SOUL_OPENING), '你不是聊天机器人，你在慢慢成为一个具体的人。');
  assert.equal(soulFirstParagraph(''), '');
  assert.equal(Array.from(soulFirstParagraph('长'.repeat(300))).length, 200);
});

test('Appends item to existing section or creates section; skips duplicate entry', () => {
  const soul = '你是我的求职顾问。\n\n## 说话\n- 先说结论。\n\n## 性格\n- 直接。';
  assert.equal(appendToSection(soul, '说话', '讲到岗位就讲对方要什么。'),
    '你是我的求职顾问。\n\n## 说话\n- 先说结论。\n- 讲到岗位就讲对方要什么。\n\n## 性格\n- 直接。');
  assert.equal(appendToSection(soul, '和我相处中形成的判断', '投递前先给我看一眼。'),
    `${soul}\n\n## 和我相处中形成的判断\n- 投递前先给我看一眼。`);
  assert.equal(appendToSection(soul, '说话', '先说结论。'), soul);
  assert.equal(appendToSection('', '说话', '先说结论。'), '## 说话\n- 先说结论。');
});

test('Line diff marks adds/deletes, groups adjacent edits, ignores blank-line-only diffs', () => {
  const before = '第一行\n第二行\n\n第三行';
  const after = '第一行\n第二行改了\n\n第三行\n第四行';
  assert.deepEqual(diffSoul(before, after), [
    { kind: 'same', text: '第一行' },
    { kind: 'remove', text: '第二行' },
    { kind: 'add', text: '第二行改了' },
    { kind: 'same', text: '' },
    { kind: 'same', text: '第三行' },
    { kind: 'add', text: '第四行' },
  ]);
  assert.equal(soulChangeCount(before, after), 2);
  assert.equal(soulChangeCount(before, `${before}\n\n`), 0);
  assert.equal(soulChangeCount(before, before), 0);
});

test('Retention ratio: 1.0 on append or empty original, 0.5 when half is replaced', () => {
  assert.equal(soulKeptShare('一\n二', '一\n二\n三'), 1);
  assert.equal(soulKeptShare('一\n二', '一\n四'), 0.5);
  assert.equal(soulKeptShare('', '一'), 1);
});

test('Teammate role parses Soul first paragraph, strips prefix/period, truncates long', () => {
  assert.equal(mateRoleOf('求职顾问', '你是我的求职顾问：简历、投递和面试准备。\n\n## 说话\n- 先说结论。'),
    '简历、投递和面试准备');
  assert.equal(mateRoleOf('求职顾问', '你是我的求职顾问。\n\n## 说话'), '求职顾问');
  assert.equal(mateRoleOf('设计师', '出界面设计稿，交回能点的样子。'), '出界面设计稿，交回能点的样子');
  assert.equal(mateRoleOf('设计师', '## 说话\n- 先给图'), '说话 - 先给图');
  assert.equal(mateRoleOf('设计师', '   '), '');
  assert.equal(Array.from(mateRoleOf('设计师', '长'.repeat(300))).length, 160);
});
