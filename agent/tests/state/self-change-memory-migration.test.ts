// 迁移 0103 / 0104（《优化清单》第 1 条，11-07 他定「清掉上下文里的改自己」）：记忆文档里明确讲 Plasticine 自迭代、改自己
// 源码、自己部署的行挪进归档（不删）；常驻项目「Plasticine」的目标还是系统写的旧说法时换成新说法。判断要保守：宁漏勿错。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RULES_DOC_ID, STANDING_PROJECT_IDS, YOU_DOC_ID } from '../../shared/state.ts';
import { MEMORY_DATABASE, openDatabase, type Database } from '../../src/state/db.ts';
import { createMemoryDocStores } from '../../src/state/memory-docs.ts';
import { migrate, MIGRATIONS } from '../../src/state/migrations/index.ts';
import { talksAboutSelfChange } from '../../src/state/migrations/0103-archive-self-change-memory.ts';
import type { StoreContext } from '../../src/state/object-store.ts';
import { createProjectStore } from '../../src/state/projects.ts';
import { steppingClock } from './helpers.ts';

const MEMORY_ID = '0103-archive-self-change-memory';
const BRIEF_ID = '0104-plasticine-project-goal';
const anchors = [{ kind: 'message' as const, ref: 'line:main:1' }];

/** 今天的记忆行存取带适用范围（0130）；在 0130 之前的库上用它写行，先补上这两列（之后的迁移不碰它们）。 */
function withScopeColumns(db: { exec(sql: string): void }): void {
  db.exec("ALTER TABLE memory_doc_lines ADD COLUMN scope_kind TEXT NOT NULL DEFAULT 'all'");
  db.exec('ALTER TABLE memory_doc_lines ADD COLUMN scope_ref TEXT');
}

function contextOf(db: Database): StoreContext {
  let next = 0;
  return { db, now: steppingClock(), newId: () => `id-${(next += 1)}` };
}

function before(db: Database, id: string): void {
  migrate(db, MIGRATIONS.filter((migration) => migration.id < id), steppingClock());
  withScopeColumns(db);
}

test('两条迁移都登记了，都不是可以删东西的迁移', () => {
  for (const id of [MEMORY_ID, BRIEF_ID]) {
    const entry = MIGRATIONS.find((migration) => migration.id === id);
    assert.ok(entry !== undefined, id);
    assert.equal(entry.destructive, undefined);
  }
});

test('判断规则：明确讲 Plasticine 改自己、自己部署的才算', () => {
  const yes = [
    '自迭代：改完先跑测试，再发',
    'Plasticine 的自我迭代每周最多三次',
    'self-iteration 通道接好了',
    '工作区放在 /home/plasticine/workspaces 下面',
    '发布用 node scripts/ship.ts release，不要手动 deploy-tencent',
    '旧的 plasticine-self 用户留着',
    'Plasticine 自己部署上线了三版',
    'Plasticine 可以自己改代码，改完告诉他',
    '橡皮泥自行发布了 Mac 0.7.5',
    'Plasticine 可以修改自己的源码',
    'plasticine 部署自己时要先备份',
  ];
  const no = [
    '朋友可以自己部署 Plasticine',
    'Plasticine 开源前要清理源码里的密钥',
    'Plasticine 帮他改自己的简历',
    '他想改自己的作息，十二点前睡',
    'Plasticine 部署在腾讯云上',
    'Cyber Hunter 下周发布',
    '他自己部署了一个博客',
    'Plasticine 用 git push 帮他把博客推上去',
  ];
  for (const text of yes) {
    assert.equal(talksAboutSelfChange(text), true, text);
  }
  for (const text of no) {
    assert.equal(talksAboutSelfChange(text), false, text);
  }
});

test('迁移 0103：只把在用的、命中规则的行挪进归档，记事件、索引标归档；别的行和已归档的不动；重跑不再改', () => {
  const db = openDatabase(MEMORY_DATABASE);
  try {
    before(db, MEMORY_ID);
    const docs = createMemoryDocStores(contextOf(db));
    docs.docs.create({ kind: 'you', title: '关于你', summary: '身份', createdBy: 'system' }, { id: YOU_DOC_ID });
    docs.docs.create({ kind: 'rules', title: '怎么替你做事', summary: '规矩', createdBy: 'system' },
      { id: RULES_DOC_ID });
    const add = (docId: string, text: string) => docs.lines.add({ docId, text, basis: 'stated', anchors,
      writtenBy: 'brain' });
    const selfRule = add(RULES_DOC_ID, '自迭代：改完先跑测试，再自己发');
    const deployFact = add(YOU_DOC_ID, 'Plasticine 自己部署上线了三版');
    const keepRule = add(RULES_DOC_ID, '发邮件前先问他');
    const keepFact = add(YOU_DOC_ID, '朋友可以自己部署 Plasticine');
    const oldSelf = add(RULES_DOC_ID, '自迭代要截图');
    docs.lines.retire(oldSelf.id, oldSelf.version, 'revised');
    const archivedBefore = docs.lines.require(oldSelf.id);
    db.run(`INSERT INTO search_docs (source, ref, kind, object_kind, object_id, title, body, detail, updated_at)
      VALUES ('memory_line', $ref, 'memory', 'memory_doc', $doc, '怎么替你做事', $body, '记忆', $at)`,
    { ref: selfRule.id, doc: RULES_DOC_ID, body: selfRule.text, at: '2026-11-01T00:00:00.000Z' });

    assert.deepEqual(migrate(db, MIGRATIONS.filter((migration) => migration.id <= MEMORY_ID), steppingClock()),
      [MEMORY_ID]);

    for (const line of [selfRule, deployFact]) {
      const after = docs.lines.require(line.id);
      assert.equal(after.retiredReason, 'no_longer_true', line.text);
      assert.notEqual(after.archivedAt, null);
      assert.equal(after.archivedAt, after.retiredAt);
      assert.equal(after.deletedAt, null, '不删');
      assert.equal(after.text, line.text, '原文留着');
      assert.equal(after.version, line.version + 1);
    }
    assert.deepEqual(docs.lines.live(RULES_DOC_ID).map((line) => line.id), [keepRule.id]);
    assert.deepEqual(docs.lines.live(YOU_DOC_ID).map((line) => line.id), [keepFact.id]);
    assert.deepEqual(docs.lines.require(oldSelf.id), archivedBefore, '已经归档的不动');
    const events = db.all(`SELECT line_id, kind, actor, detail FROM memory_doc_events
      WHERE kind = 'line_retired' AND actor = 'migration' ORDER BY line_id`);
    assert.deepEqual(events.map((row) => row['line_id']), [selfRule.id, deployFact.id].sort());
    assert.equal(JSON.parse(String(events[0]?.['detail'])).reason, 'no_longer_true');
    assert.equal(db.get(`SELECT archived FROM search_docs WHERE ref = $ref`, { ref: selfRule.id })?.['archived'], 1);

    assert.deepEqual(migrate(db, MIGRATIONS.filter((migration) => migration.id < '0130'), steppingClock())
      .includes(MEMORY_ID), false, '重跑不再改');
  } finally {
    db.close();
  }
});

test('迁移 0104：常驻项目「Plasticine」的目标还是系统写的旧说法才换，记一笔；他改过的不动', () => {
  for (const [goal, changed] of [['Plasticine 自己：合作关系、审查建议和还没做完的改造。', true],
    ['我自己写的目标', false]] as const) {
    const db = openDatabase(MEMORY_DATABASE);
    try {
      before(db, BRIEF_ID);
      const projects = createProjectStore(contextOf(db));
      const brief = { goal, constraints: '别打扰', rules: '', terms: '' };
      const project = projects.create({ name: 'Plasticine', standing: true, brief },
        { id: STANDING_PROJECT_IDS.plasticine });
      migrate(db, MIGRATIONS.filter((migration) => migration.id <= BRIEF_ID), steppingClock());
      const after = projects.require(project.id);
      const events = db.all(`SELECT kind, actor, text FROM project_events WHERE project_id = $id`, { id: project.id });
      if (changed) {
        assert.equal(after.brief.goal, 'Plasticine 自己：和他怎么合作，用下来哪里顺手、哪里不好用。');
        assert.equal(after.brief.constraints, '别打扰');
        assert.equal(after.version, project.version + 1);
        assert.deepEqual(events.map((row) => [row['kind'], row['actor']]), [['edited', 'migration']]);
        assert.ok(String(events[0]?.['text']).includes(goal), '旧说法记在事件里');
      } else {
        assert.deepEqual(after, project);
        assert.deepEqual(events, []);
      }
    } finally {
      db.close();
    }
  }
});
