import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { Value } from 'typebox/value';
import { SKILLS_PATH, SkillListResponseSchema, SkillResponseSchema } from '../../shared/api/index.ts';
import { call, json, pair, startTestApp, type TestApp } from './helpers.ts';

let app: TestApp | undefined;

/** 一个内置技能（随程序发的）：现在仓库里没有，测试自己摆一个。 */
function builtinSkills(): string {
  const root = mkdtempSync(join(tmpdir(), 'plasticine-builtin-'));
  mkdirSync(join(root, 'reading-notes'));
  writeFileSync(join(root, 'reading-notes', 'SKILL.md'), '---\nname: reading-notes\ndescription: 读书笔记怎么记\n---\n'
    + '# 读书笔记\n先摘原文，再写一句自己的话；每章一段，书名放标题，页码写在摘句后面的括号里。\n');
  return root;
}
afterEach(async () => { await app?.close(); app = undefined; });

test('技能 HTTP 按目录、正文、参考分页读取，用户浏览不改变任务已加载方法', async () => {
  app = await startTestApp([], { builtinSkills: builtinSkills() });
  const cookie = await pair(app);
  const listed = json(await call(app, 'GET', '/v2/skills?query=reading-notes', { cookie }));
  assert.ok(Value.Check(SkillListResponseSchema, listed));
  assert.equal(listed.skills.length, 1);
  const descriptor = listed.skills[0]!;
  assert.equal(descriptor.source.kind, 'builtin');
  assert.equal(Object.hasOwn(descriptor, 'text'), false);
  const body = json(await call(app, 'GET', `/v2/skills/${descriptor.name}?limit=30`, { cookie }));
  assert.ok(Value.Check(SkillResponseSchema, body));
  assert.equal(body.skill.version, descriptor.version);
  assert.equal(Array.from(body.skill.text).length, 30);
  assert.equal(body.skill.nextOffset, 30);
  assert.equal(body.skill.instructionAuthority, 'method');
  assert.equal((await call(app, 'GET', '/v2/skills/reading-notes?path=../../secret', { cookie })).status, 400);
  assert.equal((await call(app, 'GET', '/v2/skills/no-such-skill', { cookie })).status, 404);
});

test('技能列表带模型读过几次；删一个装上的技能后目录里没了，内置的删不了（409）', async () => {
  app = await startTestApp([], { builtinSkills: builtinSkills() });
  const cookie = await pair(app);
  const { skills } = app.app.deps;
  skills.write({ name: 'my-notes', content: '---\nname: my-notes\ndescription: 我的整理方法\n---\n# 整理\n先分类。\n',
    expectedVersion: null }, { actionId: 'w-1', runId: 'line:main', taskId: null });
  skills.read({ name: 'my-notes' }, 'line:main');
  const listed = json(await call(app, 'GET', '/v2/skills?query=my-notes', { cookie }));
  assert.ok(Value.Check(SkillListResponseSchema, listed));
  assert.deepEqual(listed.skills.map((skill) => [skill.name, skill.uses]), [['my-notes', 1]]);
  assert.notEqual(listed.skills[0]?.lastUsedAt, null);
  const removed = await call(app, 'DELETE', `${SKILLS_PATH}/my-notes`, { cookie, body: { requestId: 'req-skill-1' } });
  assert.equal(removed.status, 200);
  const after = json(await call(app, 'GET', '/v2/skills?query=my-notes', { cookie }));
  assert.equal((after['skills'] as unknown[]).length, 0);
  const builtin = await call(app, 'DELETE', `${SKILLS_PATH}/reading-notes`, { cookie,
    body: { requestId: 'req-skill-2' } });
  assert.equal(builtin.status, 409);
});
