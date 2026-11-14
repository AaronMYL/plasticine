// 第13批 Soul 的文字：队友的开头（原来的职责）、第一段（主线派活时看）、往一节里加一条（规则搬家）、逐行比对和改了几处。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendToSection, diffSoul, MAIN_SOUL_OPENING, mateRoleOf, mateSoulOpening, soulChangeCount,
  soulFirstParagraph, soulKeptShare } from '../../shared/soul-text.ts';

test('队友的开头写成「你是我的……」；第一段去掉标题记号、几行并成一行', () => {
  assert.equal(mateSoulOpening('求职顾问', '简历、投递和面试准备。'), '你是我的求职顾问：简历、投递和面试准备。');
  assert.equal(mateSoulOpening('设计师', ''), '你是我的设计师。');
  assert.equal(soulFirstParagraph('# 我\n你是我的求职顾问：\n管简历。\n\n## 说话\n- 先说结论'), '我 你是我的求职顾问： 管简历。');
  assert.equal(soulFirstParagraph(MAIN_SOUL_OPENING), '你不是聊天机器人，你在慢慢成为一个具体的人。');
  assert.equal(soulFirstParagraph(''), '');
  assert.equal(Array.from(soulFirstParagraph('长'.repeat(300))).length, 200);
});

test('往一节里加一条：有这一节加在节尾，没有就新起一节，一样的不重复加', () => {
  const soul = '你是我的求职顾问。\n\n## 说话\n- 先说结论。\n\n## 性格\n- 直接。';
  assert.equal(appendToSection(soul, '说话', '讲到岗位就讲对方要什么。'),
    '你是我的求职顾问。\n\n## 说话\n- 先说结论。\n- 讲到岗位就讲对方要什么。\n\n## 性格\n- 直接。');
  assert.equal(appendToSection(soul, '和我相处中形成的判断', '投递前先给我看一眼。'),
    `${soul}\n\n## 和我相处中形成的判断\n- 投递前先给我看一眼。`);
  assert.equal(appendToSection(soul, '说话', '先说结论。'), soul);
  assert.equal(appendToSection('', '说话', '先说结论。'), '## 说话\n- 先说结论。');
});

test('逐行比对：标出加的、删的；连着改的算一处，只动空行不算', () => {
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

test('原来的留下几成：加一条全留下，换掉一半是 0.5，原来是空的算全留下', () => {
  assert.equal(soulKeptShare('一\n二', '一\n二\n三'), 1);
  assert.equal(soulKeptShare('一\n二', '一\n四'), 0.5);
  assert.equal(soulKeptShare('', '一'), 1);
});

test('队友的职责从 Soul 第一段来：去掉「你是我的名字：」和句末句号，太长截断，取不出就是空的', () => {
  assert.equal(mateRoleOf('求职顾问', '你是我的求职顾问：简历、投递和面试准备。\n\n## 说话\n- 先说结论。'),
    '简历、投递和面试准备');
  assert.equal(mateRoleOf('求职顾问', '你是我的求职顾问。\n\n## 说话'), '求职顾问');
  assert.equal(mateRoleOf('设计师', '出界面设计稿，交回能点的样子。'), '出界面设计稿，交回能点的样子');
  assert.equal(mateRoleOf('设计师', '## 说话\n- 先给图'), '说话 - 先给图');
  assert.equal(mateRoleOf('设计师', '   '), '');
  assert.equal(Array.from(mateRoleOf('设计师', '长'.repeat(300))).length, 160);
});
