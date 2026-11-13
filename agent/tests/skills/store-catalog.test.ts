// 公开仓库里的技能商店（skills-store/）：清单合规，清单里每个技能的文件都在、格式都对，目录里没有清单外的技能。

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Value } from 'typebox/value';
import { SkillStoreIndexSchema } from '../../shared/api/skills.ts';
import { bundleOf, previewOf } from '../../src/skills/index.ts';

const ROOT = fileURLToPath(new URL('../../../skills-store', import.meta.url));

test('技能商店的清单和每个技能都合规', () => {
  const index: unknown = JSON.parse(readFileSync(join(ROOT, 'index.json'), 'utf8'));
  assert.ok(Value.Check(SkillStoreIndexSchema, index), JSON.stringify([...Value.Errors(SkillStoreIndexSchema, index)][0]));
  const names = index.skills.map((skill) => skill.name);
  assert.equal(new Set(names).size, names.length, '短名不能重复');
  for (const skill of index.skills) {
    assert.equal(skill.files[0], 'SKILL.md', `${skill.name} 的第一个文件是 SKILL.md`);
    const bundle = bundleOf(skill.files.map((path) => ({ path,
      content: readFileSync(join(ROOT, skill.name, path), 'utf8') })), `store:${skill.name}`);
    const preview = previewOf(bundle, false);
    assert.equal(preview.name, skill.name);
    assert.equal(preview.title, skill.title, `${skill.name} 的 title 和清单一样`);
    assert.ok(preview.text.length > 200, `${skill.name} 的方法不是空架子`);
  }
  const folders = readdirSync(ROOT).filter((entry) => statSync(join(ROOT, entry)).isDirectory()).sort();
  assert.deepEqual(folders, [...names].sort(), '目录和清单一一对应');
});
