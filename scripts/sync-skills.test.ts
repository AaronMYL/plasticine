import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { findDrift, syncSkills } from './sync-skills.ts';

async function tree(base: string, files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(base, path, '..'), { recursive: true });
    await writeFile(join(base, path), content);
  }
}

test('正本和副本一样时没有差异', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'skills-'));
  try {
    await tree(join(dir, 'a'), { 'x/SKILL.md': '一', 'x/references/r.md': '二' });
    await tree(join(dir, 'b'), { 'x/SKILL.md': '一', 'x/references/r.md': '二' });
    assert.deepEqual(await findDrift(join(dir, 'a'), join(dir, 'b')), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('内容不同、多出、缺少的文件都算差异', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'skills-'));
  try {
    await tree(join(dir, 'a'), { 'x/SKILL.md': '一', 'y/SKILL.md': '只在正本' });
    await tree(join(dir, 'b'), { 'x/SKILL.md': '改过', 'z/SKILL.md': '只在副本' });
    assert.deepEqual(await findDrift(join(dir, 'a'), join(dir, 'b')), ['x/SKILL.md', 'y/SKILL.md', 'z/SKILL.md']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('正本不存在时报错，不动副本', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'skills-'));
  try {
    await tree(join(dir, 'b'), { 'x/SKILL.md': '副本' });
    await assert.rejects(syncSkills(join(dir, 'missing'), join(dir, 'b')));
    assert.deepEqual(await findDrift(join(dir, 'b'), join(dir, 'b')), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('同步后副本和正本一致', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'skills-'));
  try {
    await tree(join(dir, 'a'), { 'x/SKILL.md': '新', 'x/references/r.md': '二' });
    await tree(join(dir, 'b'), { 'x/SKILL.md': '旧', 'old/SKILL.md': '该删' });
    assert.equal(await syncSkills(join(dir, 'a'), join(dir, 'b')), 3);
    assert.deepEqual(await findDrift(join(dir, 'a'), join(dir, 'b')), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('副本目录不存在时，正本里的每个文件都算差异', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'skills-'));
  try {
    await tree(join(dir, 'a'), { 'x/SKILL.md': '一' });
    assert.deepEqual(await findDrift(join(dir, 'a'), join(dir, 'missing')), ['x/SKILL.md']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('同一目标并发同步时拒绝重叠者，成功的一份完整保留', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'skills-'));
  try {
    const source = join(dir, 'a');
    const target = join(dir, 'b');
    await tree(source, { 'x/SKILL.md': '新', 'x/references/r.md': '内容' });
    await tree(target, { 'x/SKILL.md': '旧' });
    const results = await Promise.allSettled([syncSkills(source, target), syncSkills(source, target)]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const refused = results.find((result) => result.status === 'rejected');
    assert.ok(refused?.status === 'rejected');
    assert.match(String(refused.reason), /正在同步/);
    assert.deepEqual(await findDrift(source, target), []);
    assert.equal(await syncSkills(source, target), 0, '锁释放后可正常再同步');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
