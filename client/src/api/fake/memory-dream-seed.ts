// 假「昨晚整理了什么」（设计稿 Plasticine-Dream，11-06）：一次夜里的整理——新加 7、替换 3、拿不准 1、走不通的路 1。
// 内容是示例，不是真数据；出处的字照真服务端的样子（主线 / 「线名」· 几月几日）。

import type { MemoryDreamChangeView, MemoryDreamView, MemoryLineSource } from '../shared.ts';
import { RULES_DOC_ID } from '../shared.ts';
import { minutesAgo } from './design-projects.ts';

const HOUR = 60;

function source(now: Date, label: string, minutes: number, id: string): MemoryLineSource {
  return { kind: 'message', id, label, at: minutesAgo(now, minutes) };
}

export function dreamSeed(now: Date): MemoryDreamView {
  let n = 0;
  const change = (fields: Pick<MemoryDreamChangeView, 'kind' | 'text'> & Partial<MemoryDreamChangeView>,
    label: string, minutes: number): MemoryDreamChangeView => {
    n += 1;
    return { id: `dc_${n}`, previous: null, topicId: null, sources: [source(now, label, minutes, `dm_${n}`)],
      candidates: [], undone: false, chosen: null, canUndo: fields.kind === 'add' || fields.kind === 'replace',
      version: 1, ...fields };
  };
  return {
    id: 'dream_1',
    startedAt: minutesAgo(now, 9 * HOUR),
    finishedAt: minutesAgo(now, 9 * HOUR - 20),
    linesRead: 6,
    conversationsRead: 43,
    changes: [
      change({ kind: 'add', text: 'Plasticine 的侧栏改成图标栏 + 第二栏，只有网页算标签', topicId: 't_plasticine' },
        '主线 · 11月6日 21:14', 12 * HOUR),
      change({ kind: 'add', text: '研究周报偏基础研究、偏专业，不要科普口吻', topicId: 't_you' },
        '「研究周报」· 11月6日', 14 * HOUR),
      change({ kind: 'add', text: '技能「视频解析」：先用自带字幕，没有再本地转写', topicId: 't_video' },
        '「抖音样例」· 11月6日', 15 * HOUR),
      change({ kind: 'add', text: '周屿周四下午有空过稿', topicId: 't_zhouyu' }, '主线 · 11月6日', 16 * HOUR),
      change({ kind: 'add', text: '房租每月 5 号前转', topicId: 't_personal' }, '主线 · 11月6日', 17 * HOUR),
      change({ kind: 'add', text: '首页先放「等你」，再放「在做」', topicId: 't_plasticine' }, '主线 · 11月6日', 18 * HOUR),
      change({ kind: 'add', text: '悬赏规则先写验收一节', topicId: 't_hunter' }, '主线 · 11月6日', 19 * HOUR),
      change({ kind: 'replace', text: '通知只发消息和系统通知，不发邮件', previous: '重要的事再发一封邮件兜底（11月1日）',
        topicId: RULES_DOC_ID }, '主线 · 11月6日', 13 * HOUR),
      change({ kind: 'replace', text: '研究周报每周六早上发', previous: '研究周报每周五晚上发', topicId: 't_you' },
        '「研究周报」· 11月6日', 14 * HOUR),
      change({ kind: 'replace', text: '对账以流水为准', previous: '对账以账单汇总为准', topicId: 't_bills' },
        '主线 · 11月6日', 20 * HOUR),
      change({ kind: 'unsure', text: '悬赏先挂哪里：「GitHub Issues」和「Cyber Hunter 网站」都说过', topicId: 't_hunter',
        candidates: [
          { text: 'GitHub', sources: [source(now, '旁聊 · 11月3日', 4 * 24 * HOUR, 'dm_c1')] },
          { text: '网站', sources: [source(now, '主线 · 11月6日', 12 * HOUR, 'dm_c2')] },
        ] }, '旁聊 · 11月3日 · 主线 · 11月6日', 12 * HOUR),
      change({ kind: 'dead_end', text: '抖音的下载地址拿到腾讯云上用不了，绑了登录 IP' }, '「抖音样例」· 11月6日', 15 * HOUR),
    ],
  };
}
