// 内核优化第二批：做事经验按网站带出、记用量；后台线做完后的事后复盘写做事经验和技能（直接生效，一条只进一处）。

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import { recallExperience, Retrospector, touchedKeys, type RetroSkill, type RetroSkills }
  from '../../src/memory/index.ts';
import { noteExperience } from '../../src/memory/index.ts';
import { checkedArgs, type KernelTool } from '../../src/lines/index.ts';
import { openTestState, type TestState } from '../state/helpers.ts';
import { scriptedText } from '../tools/helpers.ts';
import { scriptByLine, startKernel, until, type Harness } from '../lines/helpers.ts';

const handles: TestState[] = [];
const kernels: Harness[] = [];

afterEach(async () => {
  for (const item of kernels.splice(0)) {
    await item.close();
  }
  for (const item of handles.splice(0)) {
    await item.cleanup();
  }
});

async function state(): Promise<TestState> {
  const handle = await openTestState();
  handles.push(handle);
  return handle;
}

const writer = { actor: 'brain' as const, ref: 'test' };

test('碰到哪些网站或应用：参数里的网址和应用名、结果开头的网址；子域名也认上一级', () => {
  assert.deepEqual(touchedKeys({ name: 'device_action', args: { action: { kind: 'tab_navigate',
    url: 'https://www.xiaohongshu.com/explore?x=1' } } }, ''), ['xiaohongshu.com']);
  assert.deepEqual(touchedKeys({ name: 'device_action', args: { action: { kind: 'app_perceive', app: '微信' } } }, ''),
    ['微信']);
  assert.deepEqual(touchedKeys({ name: 'cloud_browser_observe', args: {} }, '网址 https://mp.weixin.qq.com/cgi 标题'),
    ['mp.weixin.qq.com', 'qq.com', 'weixin.qq.com']);
});

test('带出：记了网站的那一篇在碰到网站时带出一次、记一次用量；标题认得出的旧经验也带；没有行的不带', async () => {
  const { state: s } = await state();
  noteExperience(s, { topic: '微信公众号后台', section: 'do', text: '保存草稿前先等图片上传完', lineId: s.lines.main().id,
    sites: ['mp.weixin.qq.com'] }, writer);
  noteExperience(s, { topic: '小红书', section: 'avoid', text: '链接去掉 xsec_token 会打不开', lineId: s.lines.main().id },
    writer);
  const doc = s.memoryDocs.docs.live().find((item) => item.title === '微信公众号后台')!;
  assert.deepEqual(s.memoryDocs.usage.get(doc.id)?.sites, ['mp.weixin.qq.com']);
  const shown = new Set<string>();
  const call = { name: 'device_action', args: { action: { kind: 'tab_open', url: 'https://mp.weixin.qq.com/' } } };
  const text = recallExperience(s, call, '', shown);
  assert.match(text ?? '', /做事经验「微信公众号后台」/);
  assert.match(text ?? '', /保存草稿前先等图片上传完/);
  assert.equal(recallExperience(s, call, '', shown), null, '同一条线同一篇只带一次');
  assert.equal(s.memoryDocs.usage.get(doc.id)?.useCount, 1);
  const red = recallExperience(s, { name: 'cloud_browser_open', args: { url: 'https://www.xiaohongshu.com/x' } }, '',
    new Set());
  assert.match(red ?? '', /别：链接去掉 xsec_token 会打不开/, '没记网站的旧经验按标题认');
  assert.equal(recallExperience(s, { name: 'web_fetch', args: { url: 'https://example.com' } }, '', new Set()), null);
});

test('这条经验记过了，网站照样补上', async () => {
  const { state: s } = await state();
  const lineId = s.lines.main().id;
  noteExperience(s, { topic: '抖音', section: 'do', text: '收藏夹要先点开再滚动', lineId }, writer);
  const again = noteExperience(s, { topic: '抖音', section: 'do', text: '收藏夹要先点开再滚动', lineId,
    sites: ['douyin.com'] }, writer);
  assert.equal(again.saved, false);
  const doc = s.memoryDocs.docs.live().find((item) => item.title === '抖音')!;
  assert.deepEqual(s.memoryDocs.usage.get(doc.id)?.sites, ['douyin.com']);
});

/** 一条有若干步的后台线：每一步调一次 press，第 2 步出错。 */
function seedLine(s: TestState['state'], steps: number): string {
  const line = s.lines.create({ kind: 'background', title: '发一篇公众号文章', parentLineId: s.lines.main().id,
    projectId: null });
  s.lineMessages.append(line.id, 'user', { role: 'user', content: '把草稿发出去', timestamp: 1 });
  for (let step = 1; step <= steps; step += 1) {
    s.lineMessages.append(line.id, 'assistant', fauxAssistantMessage([fauxToolCall('press',
      { url: 'https://mp.weixin.qq.com/', step }, { id: `call-${step}` })], { stopReason: 'toolUse' }));
    s.lineMessages.append(line.id, 'toolResult', { role: 'toolResult', toolCallId: `call-${step}`, toolName: 'press',
      content: [{ type: 'text', text: step === 2 ? '没找到保存按钮' : '好了' }], isError: step === 2, timestamp: 1 });
  }
  s.lineMessages.append(line.id, 'assistant', fauxAssistantMessage('发好了。'));
  return line.id;
}

function fakeSkills(initial: RetroSkill[] = []): RetroSkills & { written: string[]; skills: RetroSkill[] } {
  const skills = [...initial];
  const written: string[] = [];
  return {
    skills, written,
    list: () => skills,
    body: (name) => (skills.some((skill) => skill.name === name) ? '# 旧的做法\n1. 打开后台' : null),
    write: (name, content, expectedVersion) => {
      written.push(`${name}@${expectedVersion ?? 'new'}:${content.split('\n')[1] ?? ''}`);
    },
  };
}

/** 以前做成过的一件同类的事。 */
function doneBefore(s: TestState['state'], title = '上周发的公众号文章'): string {
  const line = s.lines.create({ kind: 'background', title, parentLineId: s.lines.main().id, projectId: null });
  return s.lines.update(line.id, { status: 'idle' }).id;
}

test('复盘：经验记进去带上网站、技能新建；同一条线第二次只看新的一段；步数太少不复盘', async () => {
  const { state: s } = await state();
  const before = doneBefore(s);
  const lineId = seedLine(s, 5);
  const said: string[] = [];
  const text = scriptedText([JSON.stringify({
    lessons: [{ topic: '微信公众号后台', sites: ['mp.weixin.qq.com'], kind: 'avoid',
      text: '保存按钮在页面底部，要先滚到底再点：顶部那个是预览' }],
    skill: { action: 'create', name: 'wechat-article-publish', description: '发公众号文章时用',
      body: '1. 打开草稿箱\n2. 滚到底点保存', sameKindLines: [before] } })]);
  const skills = fakeSkills();
  const retro = new Retrospector({ state: s, models: text.models, skills, notify: (id, words) => said.push(words) });
  const result = await retro.run(lineId, AbortSignal.timeout(5_000));
  assert.deepEqual(result, { lessons: ['微信公众号后台'], skill: '新建技能「wechat-article-publish」' });
  assert.match(text.requests[0]?.messages[0]?.content ?? '', /没找到保存按钮/, '失败的那一步在材料里');
  assert.match(text.requests[0]?.messages[0]?.content ?? '', new RegExp(`\\[线:${before}\\] 上周发的公众号文章`),
    '以前做成的事列在材料里');
  const doc = s.memoryDocs.docs.live().find((item) => item.kind === 'how')!;
  assert.deepEqual(s.memoryDocs.usage.get(doc.id)?.sites, ['mp.weixin.qq.com']);
  assert.equal(s.memoryDocs.lines.live(doc.id)[0]?.section, 'avoid');
  assert.deepEqual(skills.written, ['wechat-article-publish@new:name: wechat-article-publish']);
  assert.match(said[0] ?? '', /做事经验记了 1 条（「微信公众号后台」）；新建技能/);
  assert.equal(await retro.run(lineId, AbortSignal.timeout(5_000)), null, '没有新的一段');
  assert.equal(text.requests.length, 1);
  const short = seedLine(s, 2);
  assert.equal(await retro.run(short, AbortSignal.timeout(5_000)), null, '两步就做完的不复盘');
});

test('复盘：只改这次读过、能改的技能；没读过的、随程序带的不改；新建不和已有的重名', async () => {
  const { state: s } = await state();
  const lineId = seedLine(s, 4);
  s.lineMessages.append(lineId, 'assistant', fauxAssistantMessage([fauxToolCall('skill_read', { name: 'publish' },
    { id: 'read-1' })], { stopReason: 'toolUse' }));
  const listed: RetroSkill[] = [{ name: 'publish', description: '发文章', version: 'a'.repeat(64), editable: true },
    { name: 'guide', description: '怎么用', version: 'b'.repeat(64), editable: false }];
  const update = (name: string) => JSON.stringify({ lessons: [],
    skill: { action: 'update', name, description: '发文章', body: '1. 打开\n2. 滚到底保存' } });
  for (const [name, wrote] of [['publish', true], ['guide', false]] as const) {
    const skills = fakeSkills(listed);
    const retro = new Retrospector({ state: s, models: scriptedText([update(name)]).models, skills, notify: () => {} });
    s.kernelSettings.set('retro:cursors', {});
    await retro.run(lineId, AbortSignal.timeout(5_000));
    assert.equal(skills.written.length, wrote ? 1 : 0, name);
  }
  const skills = fakeSkills(listed);
  s.kernelSettings.set('retro:cursors', {});
  const create = JSON.stringify({ skill: { action: 'create', name: 'publish', description: 'x', body: 'y' } });
  await new Retrospector({ state: s, models: scriptedText([create]).models, skills, notify: () => {} })
    .run(lineId, AbortSignal.timeout(5_000));
  assert.deepEqual(skills.written, [], '和已有的重名不新建');
});

/** 总在某个网站上做事的工具。 */
function openTool(): KernelTool {
  const parameters = Type.Object({ url: Type.String() }, { additionalProperties: false });
  return {
    name: 'open_page', say: () => '打开网页', hardLine: () => null,
    create: () => ({ name: 'open_page', label: '打开', description: '打开网页', parameters,
      execute: async (_id, raw) => ({ content: [{ type: 'text', text: `打开了 ${checkedArgs(parameters, raw,
        'open_page').url}` }], details: {} }) }),
  };
}

test('线里：打开那个网站的那一步，结果后面带出做事经验；同一条线第二次不再带', async () => {
  const handle = await openTestState();
  const s = handle.state;
  noteExperience(s, { topic: '微信公众号后台', section: 'do', text: '保存草稿前先等图片上传完', lineId: s.lines.main().id,
    sites: ['mp.weixin.qq.com'] }, writer);
  const h = await startKernel({ handle, tools: [openTool()], extra: {
    recall: (call, resultText, shown) => recallExperience(s, call, resultText, shown) } });
  kernels.push(h);
  let seen: string[] = [];
  scriptByLine(h, { '这是主对话': [
    fauxAssistantMessage([fauxToolCall('open_page', { url: 'https://mp.weixin.qq.com/' })], { stopReason: 'toolUse' }),
    fauxAssistantMessage([fauxToolCall('open_page', { url: 'https://mp.weixin.qq.com/a' })], { stopReason: 'toolUse' }),
    (context) => {
      seen = context.messages.flatMap((message) => (message.role === 'toolResult'
        ? [message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n')] : []));
      return fauxAssistantMessage('打开了。');
    },
  ] });
  h.kernel.send('main', { text: '打开公众号后台' });
  await until(() => h.kernel.view('main').lastAnswer === '打开了。', '答完');
  assert.match(seen[0] ?? '', /做事经验「微信公众号后台」/);
  assert.doesNotMatch(seen[1] ?? '', /做事经验/);
});

test('复盘收紧：新建技能要有以前做成的同一类事；没有凭据、凭据不在列表里都不建', async () => {
  const { state: s } = await state();
  const lineId = seedLine(s, 4);
  const create = (sameKindLines?: string[]) => JSON.stringify({ lessons: [], skill: { action: 'create',
    name: 'wechat-article-publish', description: '发公众号文章时用', body: '1. 打开草稿箱',
    ...(sameKindLines === undefined ? {} : { sameKindLines }) } });
  const attempt = async (output: string): Promise<string[]> => {
    const skills = fakeSkills();
    s.kernelSettings.set('retro:cursors', {});
    await new Retrospector({ state: s, models: scriptedText([output]).models, skills, notify: () => {} })
      .run(lineId, AbortSignal.timeout(5_000));
    return skills.written;
  };
  assert.deepEqual(await attempt(create()), [], '没写凭据');
  assert.deepEqual(await attempt(create(['不存在的线'])), [], '凭据不在列表里');
  assert.deepEqual(await attempt(create([lineId])), [], '这一条自己不算');
  const before = doneBefore(s);
  assert.equal((await attempt(create([`线:${before}`]))).length, 1, '以前做成过一次，就建');
});

test('复盘收紧：同一个网站已有一篇就记进那篇；一次最多新开 1 篇', async () => {
  const { state: s } = await state();
  const lineId = seedLine(s, 4);
  noteExperience(s, { topic: '公众号后台', section: 'do', text: '草稿箱在左边栏', lineId: s.lines.main().id,
    sites: ['mp.weixin.qq.com'] }, writer);
  const output = JSON.stringify({ lessons: [
    { topic: '微信公众号', sites: ['mp.weixin.qq.com'], kind: 'do',
      text: '保存按钮在底部，先滚到底' },
    { topic: '小红书', sites: ['xiaohongshu.com'], kind: 'do', text: '发笔记要先选封面' },
    { topic: '抖音', sites: ['douyin.com'], kind: 'do', text: '收藏夹先点开再滚动' }] });
  const result = await new Retrospector({ state: s, models: scriptedText([output]).models, skills: fakeSkills(),
    notify: () => {} }).run(lineId, AbortSignal.timeout(5_000));
  assert.deepEqual(result?.lessons, ['公众号后台', '小红书']);
  assert.deepEqual(s.memoryDocs.docs.live().filter((doc) => doc.kind === 'how').map((doc) => doc.title).sort(),
    ['公众号后台', '小红书']);
});
