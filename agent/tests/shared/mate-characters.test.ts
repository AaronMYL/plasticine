import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Value } from 'typebox/value';
import { AUTO_MATE_CHARACTERS, autoMateCharacter, DEFAULT_MATE_CHARACTER, isMateCharacter, MATE_CHARACTERS }
  from '../../shared/api/mate-characters.ts';
import { MainIdentitySchema, MateDraftSchema } from '../../shared/api/mates.ts';

test('角色清单不重复，自动分的和默认的都在清单里', () => {
  assert.equal(new Set(MATE_CHARACTERS).size, MATE_CHARACTERS.length);
  assert.equal(MATE_CHARACTERS.length, 71);
  for (const id of [...AUTO_MATE_CHARACTERS, DEFAULT_MATE_CHARACTER]) assert.ok(isMateCharacter(id), id);
});

test('同一个名字总是分到同一个角色，名字不同大多分得开', () => {
  assert.equal(autoMateCharacter('资料研究员'), autoMateCharacter('资料研究员'));
  const names = ['资料研究员', '文字编辑', '日程管家', '代码助手', '产品经理', '设计师', '开发工程师', '测试工程师'];
  assert.ok(new Set(names.map(autoMateCharacter)).size >= 6);
});

test('队友头像只收清单里的角色；主线只有名字', () => {
  const draft = { name: '资料研究员', avatar: 'cat' as const, hue: 'sky', role: '整理公开资料', soul: '', purpose: null };
  assert.ok(Value.Check(MateDraftSchema, draft));
  assert.equal(Value.Check(MateDraftSchema, { ...draft, avatar: '研' }), false);
  assert.ok(Value.Check(MainIdentitySchema, { name: 'Plasticine' }));
  assert.equal(Value.Check(MainIdentitySchema, { name: 'Plasticine', avatar: '泥', hue: 'sky' }), false);
  assert.equal(isMateCharacter('constructor'), false);
});
