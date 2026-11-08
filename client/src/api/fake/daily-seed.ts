// 本地开发预置的数据（截图用）：几条信息流、几个项目（带期限的待办、档案、资料）。文字是示例，不是真数据。

import type { FakeFeed } from './fake-feed.ts';
import { seedFeedBoard } from './feed-seed.ts';
import type { FakeProjects } from './fake-projects.ts';
import { STANDING_PROJECT_IDS } from '../shared.ts';

export interface DailyParts {
  feed: FakeFeed;
  /** 项目（用户 2026-11-01 定：项目取代关切）；没给就不预置。 */
  projects?: FakeProjects;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

function seedFeed(feed: FakeFeed, now: Date): void {
  const ago = (hours: number): string => new Date(now.getTime() - hours * HOUR_MS).toISOString();
  feed.seedSource({ id: 'src_sync', kind: 'interest', label: '本地优先同步', query: 'local-first sync CRDT' });
  feed.seedSource({ id: 'src_blocked', kind: 'blocked_site', label: 'content-farm.example', level: 'off' });
  feed.seedItem({
    id: 'feed_crdt',
    title: '用 CRDT 做离线笔记同步的三年',
    origin: 'feed',
    sourceId: 'src_sync',
    url: 'https://blog.example/crdt-notes',
    site: 'blog.example',
    summary: '作者回顾了从中心服务器换到 CRDT 之后，冲突、体积和迁移各遇到了什么。',
    why: '你关注「本地优先同步」，这篇讲的正是笔记场景。',
    arrivedAt: ago(3),
  });
  feed.seedItem({
    id: 'feed_receipts',
    title: '为什么个人工具更需要「回执」',
    origin: 'manual',
    sourceId: 'src_manual',
    summary: '把每次操作的结果显式记下来，比事后猜要省心。',
    why: '你最近在想「结果待核实」怎么呈现。',
    arrivedAt: ago(6),
    saved: true,
  });
  feed.seedItem({
    id: 'feed_hidden',
    title: '十个让你效率翻倍的小技巧',
    origin: 'feed',
    sourceId: 'src_sync',
    site: 'content-farm.example',
    why: '标题里有「同步」。',
    arrivedAt: ago(8),
    reaction: 'dislike',
  });
}

export function seedDaily(parts: DailyParts, now: Date): void {
  seedFeed(parts.feed, now);
  seedFeedBoard(parts.feed, now);
  if (parts.projects !== undefined) {
    seedProjects(parts.projects, now);
  }
}

function seedProjects(projects: FakeProjects, now: Date): void {
  const ago = (hours: number): string => new Date(now.getTime() - hours * HOUR_MS).toISOString();
  const day = (offset: number): string => new Date(now.getTime() + offset * 24 * HOUR_MS).toISOString().slice(0, 10);
  projects.seed({
    id: 'project_hunter',
    name: 'Cyber Hunter',
    due: day(4),
    status: { text: '登记 3 / 10，离停止标准还有 4 天；按现在的速度到期大约 5 / 10。', by: 'brain', at: ago(4) },
    next: '发今天的 X 采访',
    proposedHealth: { value: 'risk', reason: '登记速度跟不上停止标准', at: ago(4) },
    // 2026-11-05：关切并进项目成了带期限的待办。
    todos: [{ id: 'todo_invite', title: '给阿杰和小林发邀请码', due: day(1) }, { id: 'todo_dns', title: '域名解析',
      due: day(3) }, { id: 'todo_relay', title: '中继上线', due: day(5) },
    { id: 'todo_friends', title: '第一批朋友用上', due: day(25) }],
    brief: {
      goal: '是什么：人和私人 AI 之间的任务平台\n先做：让对方的 AI 帮你办件事',
      constraints: '现在：两周试跑，第 6 天\n第一批：3 位朋友：VPS、Mac、Windows',
      rules: '中继：放腾讯云，只转加密字节',
      terms: '',
    },
    decisions: [{ id: 'decision_open', text: '开源：先公开代码', quoteRef: 'line:line-main:1', at: ago(26) }],
    people: [{ who: '你', does: '产品、运营、每日采访' }, { who: 'Plasticine', does: '剪帖、整理仓库、每周现状' }],
    materials: [
      { kind: 'note', ref: 'note_0001', title: 'Cyber Hunter 方案', at: ago(48) },
      { kind: 'note', ref: 'seed_note_2', title: '中继方案对比', at: ago(30) },
      { kind: 'note', ref: 'seed_note_1', title: '第一批朋友', at: ago(6) },
      { kind: 'link', ref: 'https://github.com/example/plasticine', title: 'GitHub · plasticine', at: ago(200) },
    ],
    activity: [
      { at: ago(5), text: '登记：周三活动现场', source: 'reality' },
      { at: ago(26), text: '对话里定下：先公开代码', source: 'user' },
      { at: ago(30), text: '归进来一份资料：每日采访记录', source: 'plasticine' },
      { at: ago(120), text: '每周现状：登记 1 / 10，网站上线后访问 312 次', source: 'plasticine' },
    ],
  });
  projects.seed({
    id: 'project_handover',
    name: '资料交接（示例）',
    due: day(-2),
    health: 'off',
    status: { text: '「资料第二版」过了约定日期，还没交。', by: 'user', at: ago(72) },
    next: '把待确认的问题列给对方',
  });
  projects.seed({
    id: STANDING_PROJECT_IDS.plasticine,
    name: 'Plasticine',
    standing: true,
    health: 'ok',
    status: { text: '用户视角审查 16 条，已做完 11 条。', by: 'brain', at: ago(1) },
    next: '看项目页',
  });
  projects.seed({
    id: STANDING_PROJECT_IDS.personal,
    name: '个人',
    standing: true,
    health: 'ok',
    status: { text: '每月对账在履约；信息流在留意 1 个方向。', by: 'brain', at: ago(20) },
    todos: [{ title: '每月 5 号前把上月账单对完' }, { title: '要不要换掉现在的记账 App' }],
  });
}
