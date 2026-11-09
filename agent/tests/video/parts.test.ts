import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { SkillStore } from '../../src/skills/index.ts';
import {
  DEFAULT_PROMPTS,
  douyinTarget,
  parseSubtitle,
  resultOf,
  seedVideoSkill,
  skillPrompt,
  transcriberFromEnv,
  transcriptText,
  videoSkillDirectory,
  videoTarget,
  webTarget,
} from '../../src/video/index.ts';

test('认链接：抖音作品页、modal_id、图文 note；短链跟一次跳转；别的网站按清洗后的链接算 ID', async () => {
  assert.equal(douyinTarget('https://www.douyin.com/video/7300000000000000001?previous_page=x')?.workId,
    '7300000000000000001');
  assert.equal(douyinTarget('https://www.douyin.com/user/self?modal_id=7300000000000000002')?.workId,
    '7300000000000000002');
  assert.equal(douyinTarget('https://www.douyin.com/note/7300000000000000003')?.kind, 'images');
  assert.equal(douyinTarget('https://www.douyin.com/user/self'), null);
  const short = await videoTarget('https://v.douyin.com/abcd/', AbortSignal.timeout(1000),
    async () => 'https://www.iesdouyin.com/share/video/7300000000000000004/?region=CN');
  assert.deepEqual(short, { platform: 'douyin', workId: '7300000000000000004', kind: null,
    url: 'https://www.douyin.com/video/7300000000000000004' });
  const a = webTarget('https://www.youtube.com/watch?v=abc&utm_source=x#t=1');
  const b = webTarget('https://www.youtube.com/watch?v=abc');
  assert.equal(a.workId, b.workId);
  await assert.rejects(videoTarget('ftp://example.com/a.mp4', AbortSignal.timeout(1000)), /http/);
});

test('自带字幕读成逐字稿：srt、vtt（去掉滚动重复和标签）、抖音 JSON（毫秒）', () => {
  const srt = '1\n00:00:01,000 --> 00:00:03,000\n先说结论\n\n2\n00:01:05,500 --> 00:01:07,000\n回撤时别停投\n';
  assert.equal(transcriptText(parseSubtitle(srt, 'srt')), '[00:01] 先说结论\n[01:05] 回撤时别停投');
  const vtt = 'WEBVTT\n\n00:00.000 --> 00:02.000\n<c>hello</c>\n\n00:02.000 --> 00:04.000\nhello\n\n'
    + '00:04.000 --> 00:06.000\nworld\n';
  assert.deepEqual(parseSubtitle(vtt, 'vtt').map((line) => line.text), ['hello', 'world']);
  const json = JSON.stringify({ utterances: [{ text: '第一句', start_time: 0 }, { text: '第二句', start_time: 62_000 }] });
  assert.equal(transcriptText(parseSubtitle(json, 'json')), '[00:00] 第一句\n[01:02] 第二句');
});

test('转写引擎的输出按 schema 读；没配环境变量就没有本地转写', () => {
  const out = resultOf(JSON.stringify({ engine: 'sensevoice', audioSeconds: 12.5, peakMb: 480,
    segments: [{ start: 0, text: '你好' }, { start: 2, text: ' ' }] }));
  assert.deepEqual(out.lines, [{ start: 0, text: '你好' }]);
  assert.equal(out.peakMb, 480);
  assert.throws(() => resultOf('{"engine":1}'), /格式/);
  assert.equal(transcriberFromEnv({}), null);
  assert.equal(transcriberFromEnv({ PLASTICINE_TRANSCRIBE_ENGINE: 'sensevoice',
    PLASTICINE_TRANSCRIBE_MODEL: '/opt/models/sense-voice' })?.name, 'sensevoice:sense-voice');
});

test('视频解析技能装进数据目录：只装一次，改过的提示词不被覆盖，技能库里搜得到', () => {
  const directory = mkdtempSync(join(tmpdir(), 'video-skill-'));
  try {
    assert.equal(seedVideoSkill(directory), true);
    const file = join(videoSkillDirectory(directory), 'prompts', 'summary.md');
    assert.equal(readFileSync(file, 'utf8').trim(), DEFAULT_PROMPTS.summary);
    writeFileSync(file, '我改过的提示词');
    assert.equal(seedVideoSkill(directory), false);
    assert.equal(skillPrompt(directory)('summary'), '我改过的提示词');
    assert.equal(skillPrompt(directory)('images'), DEFAULT_PROMPTS.images);
    const skills = new SkillStore({ stateDirectory: directory });
    const found = skills.search('视频');
    assert.deepEqual(found.issues, []);
    assert.ok(found.skills.some((skill) => skill.name === 'video-parse'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('没人改过的旧版技能说明换成新版；改过的不动', () => {
  const directory = mkdtempSync(join(tmpdir(), 'video-skill-'));
  try {
    seedVideoSkill(directory);
    const skill = join(videoSkillDirectory(directory), 'SKILL.md');
    const retired = readFileSync(join(import.meta.dirname, 'fixtures', 'video-skill-2026-11-07.md'), 'utf8');
    writeFileSync(skill, retired);
    seedVideoSkill(directory);
    assert.match(readFileSync(skill, 'utf8'), /抖音视频直接在本体这台机器上下载/);
    writeFileSync(skill, '我自己写的说明');
    seedVideoSkill(directory);
    assert.equal(readFileSync(skill, 'utf8'), '我自己写的说明');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
