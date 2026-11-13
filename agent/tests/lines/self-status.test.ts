// 「你现在的状态」：系统提示里现读后台工作和电脑在不在线（11-12 主动性一批）。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { statusSection } from '../../src/lines/self-status.ts';
import { Mates } from '../../src/mates/service.ts';
import { openTestState } from '../state/helpers.ts';
import { startKernel } from './helpers.ts';

const NOW = new Date('2026-11-12T10:00:00.000Z');

test('在做、排队、等他、没做成的各列出来；当前这条线不列；封起来的答话线不列', async () => {
  const t = await openTestState();
  try {
    const { lines } = t.state;
    const open = (title: string, status: 'running' | 'queued' | 'waiting' | 'failed' | 'idle', extra = {}) => {
      const line = lines.create({ kind: 'background', parentLineId: null, projectId: null, title });
      return lines.update(line.id, { status, ...extra });
    };
    const current = open('我自己', 'running');
    open('查三家中继方案', 'running');
    open('整理访谈稿', 'queued');
    open('订机票', 'waiting');
    open('抓抖音收藏', 'failed', { failure: '电脑不在线，取不到登录状态' });
    open('写周报', 'idle', { unmetReason: '有两个来源打不开' });
    open('早就做完的', 'idle');
    const sealed = lines.create({ kind: 'background', parentLineId: null, projectId: null, title: '回 @someone',
      sealedPrompt: '只替主人答这一个问题。' });
    lines.update(sealed.id, { status: 'running' });
    const text = statusSection(t.state, current, new Date(Date.parse(current.updatedAt) + 60_000));
    assert.match(text, /在做（1）：\n- 「查三家中继方案」/);
    assert.match(text, /排着队（1）：\n- 「整理访谈稿」/);
    assert.match(text, /等他回答（1）：\n- 「订机票」/);
    assert.match(text, /没做成（2）：/);
    assert.match(text, /「抓抖音收藏」.*电脑不在线，取不到登录状态/);
    assert.match(text, /「写周报」.*有两个来源打不开/);
    assert.doesNotMatch(text, /我自己|早就做完的|回 @someone/);
    assert.match(text, /电脑：还没有连上电脑/);
    assert.match(text, /不再开一件/);
  } finally {
    await t.close();
  }
});

test('没有后台工作时说一句没有；电脑在线、不在线分开说', async () => {
  const t = await openTestState();
  try {
    const main = t.state.lines.main();
    assert.match(statusSection(t.state, main, NOW), /后台现在没有在做的事。/);
    const at = NOW.toISOString();
    t.state.nodes.create({ name: '书房的电脑', platform: 'windows', appVersion: '2026.1112.1', protocolVersion: 1,
      capabilities: [], credentialHash: 'a'.repeat(64), pairingCodeId: 'code-1', pairedAt: at, lastSeenAt: at });
    assert.match(statusSection(t.state, main, NOW), /电脑：书房的电脑 在线。/);
    assert.match(statusSection(t.state, main, new Date(NOW.getTime() + 10 * 60_000)), /书房的电脑 现在不在线/);
  } finally {
    await t.close();
  }
});

test('没有线表的地方（最小的测试内核）不写这一节', async () => {
  const t = await openTestState();
  try {
    assert.equal(statusSection({}, t.state.lines.main(), NOW), '');
  } finally {
    await t.close();
  }
});

test('队友各自在干什么：空着、后台在做几件', async () => {
  const h = await startKernel();
  try {
    const { state } = h.handle;
    const mates = new Mates(state, () => h.kernel);
    const a = mates.create({ name: '资料研究员', role: '整理公开资料', avatar: 'cat' as const, hue: 'sky', soul: '', purpose: null });
    mates.create({ name: '文字编辑', role: '改稿', avatar: 'bunny' as const, hue: 'rose', soul: '', purpose: null });
    const work = state.lines.create({ kind: 'background', parentLineId: null, projectId: null, title: '查三家中继',
      mateId: a.id });
    state.lines.update(work.id, { status: 'running' });
    const text = statusSection(state, state.lines.main(), new Date(Date.parse(work.updatedAt) + 60_000));
    assert.match(text, /队友：\n- 资料研究员（.+，整理公开资料）：后台在做 1 件（「查三家中继」）\n- 文字编辑（.+，改稿）：空着/);
    assert.match(text, /「查三家中继」（.+，资料研究员在做）/);
  } finally {
    await h.close();
  }
});
