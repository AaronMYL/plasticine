// 技能从外面来的三条路（技能页的「添加」，11-13）：商店清单、网址、一组文件；还有新建时让模型写的草稿。
// 都不出网：读网址的那一步换成假的。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bundleOf, githubTree, hasScripts, parseDraft, previewOf, skillDocument, skillFileUrl, SkillShop,
  SkillShopError, skillTitle } from '../../src/skills/index.ts';

const DOC = '---\nname: meeting-notes\ntitle: "会议纪要"\ndescription: 收到会议转写要整理成纪要的时候\n---\n\n1. 通读转写。\n';
const INDEX = { version: 1, skills: [{ name: 'meeting-notes', title: '会议纪要', description: '把会议转写整理成纪要',
  category: '办公', source: 'official', updatedAt: '2026-11-13', files: ['SKILL.md', 'references/sample.md'] }] };
const signal = (): AbortSignal => AbortSignal.timeout(5_000);

function shop(pages: Record<string, string>, seen: string[] = [], now = () => 0): SkillShop {
  return new SkillShop({ now, fetchText: async (url) => {
    seen.push(url);
    const page = pages[url];
    if (page === undefined) { throw new Error(`假的网里没有 ${url}`); }
    return page;
  } });
}

const RAW = 'https://raw.githubusercontent.com/AaronMYL/plasticine/main/skills-store';
const MIRROR = 'https://cdn.jsdelivr.net/gh/AaronMYL/plasticine@main/skills-store';

test('商店清单：先读 GitHub 原文，读不到换镜像；十分钟内不重读', async () => {
  const seen: string[] = [];
  let time = 0;
  const store = shop({ [`${MIRROR}/index.json`]: JSON.stringify(INDEX) }, seen, () => time);
  assert.deepEqual((await store.catalog(signal())).map((skill) => skill.name), ['meeting-notes']);
  assert.deepEqual(seen, [`${RAW}/index.json`, `${MIRROR}/index.json`]);
  await store.catalog(signal());
  assert.equal(seen.length, 2);
  time = 11 * 60_000;
  await store.catalog(signal());
  assert.equal(seen.length, 4);
});

test('商店连不上、清单格式不对：给人看得懂的原因', async () => {
  await assert.rejects(shop({}).catalog(signal()),
    (error) => error instanceof SkillShopError && error.code === 'unreachable' && /连不上技能商店/.test(error.message));
  await assert.rejects(shop({ [`${RAW}/index.json`]: '{"version":2}' }).catalog(signal()),
    (error) => error instanceof SkillShopError && error.code === 'invalid');
});

test('从商店装：按清单把每个文件读来，名字要和清单对得上；先看得到全文和有没有脚本', async () => {
  const store = shop({ [`${RAW}/index.json`]: JSON.stringify(INDEX), [`${RAW}/meeting-notes/SKILL.md`]: DOC,
    [`${RAW}/meeting-notes/references/sample.md`]: '一份样子' });
  const bundle = await store.bundle({ kind: 'store', name: 'meeting-notes' }, signal());
  assert.equal(bundle.origin, 'store:meeting-notes');
  assert.deepEqual(Object.keys(bundle.files).sort(), ['SKILL.md', 'references/sample.md']);
  const preview = previewOf(bundle, false);
  assert.deepEqual({ name: preview.name, title: preview.title, scripts: preview.scripts, installed: preview.installed },
    { name: 'meeting-notes', title: '会议纪要', scripts: false, installed: false });
  assert.match(preview.text, /通读转写/);
  await assert.rejects(store.bundle({ kind: 'store', name: 'no-such' }, signal()),
    (error) => error instanceof SkillShopError && error.code === 'not_found');
});

test('从网址装：GitHub 目录按它的目录接口列文件；blob 页面换成原文；别的网址要指到 SKILL.md', async () => {
  const tree = { tree: [{ path: 'skills/meeting-notes/SKILL.md', type: 'blob' },
    { path: 'skills/meeting-notes/scripts/clean.py', type: 'blob' }, { path: 'skills/other/SKILL.md', type: 'blob' },
    { path: 'skills/meeting-notes/references', type: 'tree' }] };
  const store = shop({ 'https://api.github.com/repos/someone/skills/git/trees/main?recursive=1': JSON.stringify(tree),
    'https://raw.githubusercontent.com/someone/skills/main/skills/meeting-notes/SKILL.md': DOC,
    'https://raw.githubusercontent.com/someone/skills/main/skills/meeting-notes/scripts/clean.py': 'print(1)',
    'https://example.org/x/SKILL.md': DOC });
  const fromTree = await store.bundle({ kind: 'url',
    url: 'https://github.com/someone/skills/tree/main/skills/meeting-notes' }, signal());
  assert.deepEqual(Object.keys(fromTree.files).sort(), ['SKILL.md', 'scripts/clean.py']);
  assert.equal(previewOf(fromTree, true).scripts, true);
  const fromBlob = await store.bundle({ kind: 'url',
    url: 'https://github.com/someone/skills/blob/main/skills/meeting-notes/SKILL.md' }, signal());
  assert.deepEqual(Object.keys(fromBlob.files), ['SKILL.md']);
  assert.equal((await store.bundle({ kind: 'url', url: 'https://example.org/x/SKILL.md' }, signal())).name,
    'meeting-notes');
  await assert.rejects(store.bundle({ kind: 'url', url: 'https://example.org/readme' }, signal()),
    (error) => error instanceof SkillShopError && error.code === 'invalid' && /SKILL\.md/.test(error.message));
  await assert.rejects(store.bundle({ kind: 'url', url: 'https://example.org/missing/SKILL.md' }, signal()),
    (error) => error instanceof SkillShopError && error.code === 'unreachable');
});

test('网址认法', () => {
  assert.deepEqual(githubTree('https://github.com/a/b/tree/main/x/y/'), { repo: 'a/b', ref: 'main', path: 'x/y' });
  assert.equal(githubTree('https://github.com/a/b'), null);
  assert.equal(skillFileUrl('https://github.com/a/b/blob/dev/x/SKILL.md'),
    'https://raw.githubusercontent.com/a/b/dev/x/SKILL.md');
  assert.equal(skillFileUrl('https://example.org/readme.md'), null);
});

test('一组文件：挑的是文件夹时去掉那一层；没有 SKILL.md、名字不合规、不是文字都不收', () => {
  const bundle = bundleOf([{ path: 'meeting-notes/SKILL.md', content: DOC },
    { path: 'meeting-notes/references/a.md', content: '样子' }, { path: 'other.txt', content: '别的' }], 'files');
  assert.deepEqual(Object.keys(bundle.files).sort(), ['SKILL.md', 'references/a.md']);
  assert.throws(() => bundleOf([{ path: 'a.md', content: '没有' }], 'files'), /没有 SKILL\.md/);
  assert.throws(() => bundleOf([{ path: 'SKILL.md', content: '---\nname: 会议\ndescription: x\n---\n' }], 'files'),
    /name/);
  assert.throws(() => bundleOf([{ path: 'SKILL.md', content: DOC }, { path: 'bin.dat', content: 'a\0b' }], 'files'),
    /不是文字文件/);
  assert.throws(() => bundleOf([{ path: 'SKILL.md', content: DOC }, { path: '.env', content: 'x' }], 'files'),
    /路径不能放进技能/);
});

test('界面填的四样拼成 SKILL.md，再读得回名字；脚本的认法', () => {
  const document = skillDocument({ name: 'trip-plan', title: '旅行计划', description: '要排行程的时候：按天排',
    body: '1. 先问去几天。' });
  assert.equal(skillTitle(document), '旅行计划');
  assert.equal(bundleOf([{ path: 'SKILL.md', content: document }], 'user').name, 'trip-plan');
  assert.equal(skillTitle('---\nname: x\ndescription: y\n---\n'), null);
  assert.equal(hasScripts(['SKILL.md', 'references/a.md', 'assets/logo.png']), false);
  assert.equal(hasScripts(['SKILL.md', 'tools/run.sh']), true);
});

test('草稿：从模型回的话里抠出 JSON，短名不合规就修；缺方法的不要', () => {
  const draft = parseDraft('```json\n{"title":"会议纪要","name":"Meeting Notes","description":"收到转写时","body":"1. 通读。"}\n```');
  assert.deepEqual(draft, { title: '会议纪要', name: 'meeting-notes', description: '收到转写时', body: '1. 通读。' });
  assert.equal(parseDraft('{"title":"周报","name":"周报","description":"每周五","body":"1. 列。"}').name, '');
  assert.throws(() => parseDraft('写不出来'), /没写成/);
  assert.throws(() => parseDraft('{"title":"x","name":"x","description":"y","body":""}'), /没写全/);
});
