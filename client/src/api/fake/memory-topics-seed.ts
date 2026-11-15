// 假记忆主题（设计稿 2026-11-02）：关于你、主线的 Soul、人、项目、话题各几页活文档，加上「拿不准的」几条。
// 人名是虚构的示例；每行都带一条来源（链回原话 / 约定）。内容是示例，不是真数据。
// 第 4 批：原来写在「关于你」里的「做事的规矩」挪进「主线的 Soul」（RULES_DOC_ID，和真服务端同一个标识）。
// 11-05：词表并进「主线的 Soul」，原来「说话方式」里那两条词语约定挪过去，出处写「词表」。

import {
  docLinkNames, GRANTS_DOC_ID, PROACTIVE_DOC_ID, RULES_DOC_ID, type MemoryDocLine, type MemoryDocSection,
  type MemoryLineSection, type MemoryTopicView, type UncertainItem,
} from '../shared.ts';
import { DESIGN_PROJECTS, minutesAgo } from './design-projects.ts';

/** 一行多出来的几样（记忆分层）：改之前那句、只限哪里。 */
export interface LineExtra {
  previous?: string;
  scope?: string;
}

export type LineSeed = [
  text: string, basis: MemoryDocLine['basis'], source: string, minutesBefore: number, uncertain?: string | null,
  extra?: LineExtra,
];

export interface TopicSeed {
  topic: MemoryTopicView;
  /** section：分了段的几篇（承诺和授权、主动告诉你、做事经验）是哪一段。 */
  sections: Array<{ heading: string; section?: MemoryLineSection; lines: LineSeed[] }>;
}

const DAY = 24 * 60;

function topic(fields: Pick<MemoryTopicView, 'id' | 'kind' | 'title' | 'summary'> & Partial<MemoryTopicView>,
  now: Date, minutes: number): MemoryTopicView {
  const material = fields.project == null ? { kind: 'memory_topic' as const, id: fields.id, version: 0 }
    : { kind: 'project' as const, id: fields.project.id, version: 0 };
  return { lineCount: 0, updatedAt: minutesAgo(now, minutes), project: null, uncertainCount: 0, tier: 'private',
    material, overLimit: false, ...fields };
}

/** 记忆分层（11-15 设计稿）：说好的两页（承诺和授权、主动告诉你）和几篇做事经验。 */
function layerSeeds(now: Date): TopicSeed[] {
  return [
    { topic: topic({ id: GRANTS_DOC_ID, kind: 'grants', title: '承诺和授权', summary: '承诺和授权' }, now, 30),
      sections: [
        { heading: '可以直接做', section: 'allow', lines: [
          ['给周屿发消息不用先问', 'quote', '主线 · 11月12日', 3 * DAY, null, { scope: '只限 Plasticine 项目' }],
          ['定时任务可以自己加，加完告诉你', 'quote', '主线 · 11月9日', 6 * DAY],
        ] },
        { heading: '先问你', section: 'ask', lines: [
          ['改线上数据之前先问', 'quote', '主线 · 11月13日', 2 * DAY],
          ['发到群组里的话先给你看', 'quote', '主线 · 11月11日', 4 * DAY],
          ['订阅新的信息源之前先问', 'quote', '主线 · 11月7日', 8 * DAY],
        ] },
        { heading: '先停着', section: 'hold', lines: [
          ['每周回顾先停，等你开口', 'quote', '主线 · 11月14日', DAY],
        ] },
        { heading: '答应你的', section: 'promise', lines: [
          ['抖音收藏有新的就整理，周日汇总一次', 'quote', '主线 · 11月9日', 6 * DAY],
          ['读完一本书给你一页笔记', 'quote', '主线 · 11月5日', 10 * DAY],
        ] },
      ] },
    { topic: topic({ id: PROACTIVE_DOC_ID, kind: 'proactive', title: '主动告诉你', summary: '主动告诉你' }, now, 40),
      sections: [
        { heading: '别提的', section: 'never', lines: [
          ['周末不提工作上的事', 'quote', '主线 · 11月12日', 3 * DAY],
          ['回过「知道了」的事不再提第二次', 'quote', '主线 · 11月10日', 5 * DAY],
          ['股票涨跌不用说', 'quote', '主线 · 11月8日', 7 * DAY],
        ] },
        { heading: '什么时候', section: 'when', lines: [
          ['开会的时候不打扰', 'quote', '主线 · 11月13日', 2 * DAY],
          ['通勤那段只发要紧的', 'quote', '主线 · 11月11日', 4 * DAY],
        ] },
        { heading: '怎么通知', section: 'style', lines: [
          ['一句话说完，细节放链接里', 'quote', '主线 · 11月12日', 3 * DAY],
        ] },
      ] },
    { topic: topic({ id: 't_how_xhs', kind: 'how', title: '小红书', summary: '打开链接、读正文、存进资料库' }, now, 10 * 60),
      sections: [
        { heading: '做法', section: 'do', lines: [
          ['链接要带着 xsec_token 才打得开；从分享文案里取整条链接，不自己拼。', 'tried', '存小红书笔记', 2 * DAY],
          ['存进资料库时把封面图一起存，不然列表里只有标题。', 'quote', '主线 · 11月12日', 3 * DAY],
          ['图文笔记的正文在第一屏，评论要往下滚两屏才出来。', 'tried', '存小红书笔记', 2 * DAY],
        ] },
        { heading: '要避开的', section: 'avoid', lines: [
          ['没登录时搜索页只给 20 条，不能当成全部结果。', 'tried', '找露营装备的测评', 4 * DAY],
          ['连着打开超过 30 篇会弹验证，隔几分钟再继续。', 'tried', '整理收藏夹', DAY, null,
            { previous: '连着打开超过 50 篇会弹验证。' }],
        ] },
      ] },
    { topic: topic({ id: 't_how_mail', kind: 'how', title: '发邮件', summary: '草稿、附件、发之前给你看' }, now, 2 * DAY),
      sections: [
        { heading: '做法', section: 'do', lines: [
          ['发之前先把草稿给你看。', 'quote', '主线 · 11月10日', 5 * DAY],
          ['附件超过 20M 先传网盘，正文里放链接。', 'tried', '给周屿发采访素材', 3 * DAY],
        ] },
      ] },
  ];
}

export function topicSeeds(now: Date): TopicSeed[] {
  return [
    ...layerSeeds(now),
    { topic: topic({ id: 't_you', kind: 'about_you', title: '关于你', summary: '身份、住处、作息和长期偏好',
      uncertainCount: 2 }, now, 50), sections: [
      { heading: '作息', lines: [
        ['晚上十点以后回消息明显变短；那时不问要你定的事。', 'agreement', '约定 · 10-27', 6 * DAY],
        ['周末不排任何工作提醒。', 'quote', '对话 · 10-26', 7 * DAY, 'u_weekend'],
        ['早上 8:30–9:10 是通勤，多半在 iPhone 上读书。', 'inferred', '图书打开记录 · 近两周', 2 * DAY, 'u_commute'],
      ] },
      { heading: '偏好', lines: [
        ['对账时更信流水，不信账单上的汇总数。', 'quote', '对话 · 10-26', 7 * DAY],
        ['更在意能不能接着做，而不是做得多快。', 'quote', '对话 · 10-26', 7 * DAY],
        ['首页要一眼看出卡片是哪一类。', 'quote', '事「首页怎么排」· 昨天', 15 * 60],
      ] },
      { heading: '说话方式', lines: [
        ['用语音输入，错字多；可能改变意思的错字，先说出解出来的版本让你确认。', 'agreement', '约定 · 10-21', 12 * DAY],
      ] },
    ] },
    { topic: topic({ id: RULES_DOC_ID, kind: 'rules', title: '规则',
      summary: '你明说的规矩；最前面是不管多有把握都先问你的几类事' }, now, 20), sections: [
      { heading: '规矩', lines: [
        ['要你定的事一律给选项，推荐的放第一个。', 'agreement', '约定', 12 * DAY],
        ['改设计先出电脑和手机截图，看过再上线。', 'agreement', '约定', 12 * DAY],
        ['通知、提醒走邮件，不用手机推送。', 'agreement', '约定', 12 * DAY],
        ['发布不做预检，直接发。', 'quote', '11-04 对话', 20],
        ['回答先给结论，依据放在后面。', 'inferred', '11-04 对话', 30],
        ['「接上」指的是回到上次停下的那一步继续，不从头开始', 'agreement', '词表', 30 * DAY],
        ['「先不」指的是这次不做，也不算拒绝，之后可以再提', 'agreement', '词表', 30 * DAY],
      ] },
    ] },
    { topic: topic({ id: 't_zhouyu', kind: 'person', title: '周屿', summary: 'Cyber Hunter 的合作者；说话直接，周四下午有空',
      uncertainCount: 1, tier: 'friend' }, now, 3 * DAY), sections: [
      { heading: '是谁', lines: [['Cyber Hunter 的合作者，负责采访对象。', 'quote', '对话 · 10-22', 11 * DAY]] },
      { heading: '怎么一起做事', lines: [
        ['周四下午有空过稿。', 'quote', '对话 · 10-29', 4 * DAY],
        ['更愿意用语音过稿，不想看长文。', 'inferred', '三次采访稿都回了语音', 3 * DAY, 'u_zhouyu'],
      ] },
    ] },
    { topic: topic({ id: 't_linyue', kind: 'person', title: '林悦', summary: '朋友，在试用 Plasticine；不聊工作' }, now, 9 * DAY),
      sections: [{ heading: '是谁', lines: [['朋友，在试用 Plasticine；数据和你的分开。', 'quote', '对话 · 10-20',
        13 * DAY]] }] },
    { topic: topic({ id: 't_hunter', kind: 'project', title: 'Cyber Hunter', summary: '悬赏规则、赏金来源和第一批 Hunter',
      project: DESIGN_PROJECTS.hunter, tier: 'public' }, now, 90), sections: [
      { heading: '目标', lines: [['先写清验收规则。', 'quote', '对话 · 10-21', 12 * DAY]] },
      { heading: '停止标准', lines: [['两周没有进展就停下来复盘。', 'quote', '对话 · 10-21', 12 * DAY]] },
      { heading: '决定', lines: [
        ['每天发一条采访短帖，双语。', 'quote', '对话 · 10-25', 8 * DAY],
        ['先用免费渠道，不投放。', 'quote', '对话 · 10-21', 12 * DAY],
      ] },
      { heading: '分工', lines: [['[[周屿]] 找采访对象；Plasticine 剪辑和发帖；你定发什么。', 'quote', '对话 · 10-22',
        11 * DAY]] },
    ] },
    { topic: topic({ id: 't_plasticine', kind: 'project', title: 'Plasticine', summary: '定下的方向、装法、记忆库和侧栏方案',
      project: DESIGN_PROJECTS.plasticine, tier: 'partner' }, now, 40), sections: [
      { heading: '最近的决定', lines: [
        ['「今日」改名「首页」，当总览，不用固定模块。', 'quote', '对话 · 11-02', 300],
        ['会话是内部细节；用户只跟主会话说话，每件事自己有线。', 'quote', '对话 · 11-02', 120],
      ] },
    ] },
    { topic: topic({ id: 't_personal', kind: 'project', title: '个人', summary: '房租、健身、出行',
      project: DESIGN_PROJECTS.personal }, now, DAY), sections: [
      { heading: '在推进', lines: [['每月 5 号前把上月账单对完。', 'quote', '对话 · 10-26', 7 * DAY]] },
    ] },
    { topic: topic({ id: 't_forecast', kind: 'topic', title: '预测与概率', summary: '你怎么用 p、什么才算现实结果' }, now, 5 * DAY),
      sections: [{ heading: '口径', lines: [['p 只被现实结果改动，不跟着讨论走。', 'agreement', '约定 · 10-21', 12 * DAY]] }] },
    { topic: topic({ id: 't_style', kind: 'topic', title: '写作文风', summary: '润色时要保住的几样：短句、不堆成语' }, now, 6 * DAY),
      sections: [{ heading: '要保住的', lines: [['短句；不堆成语；口语照留。', 'quote', '笔记 · 什么叫极强的个人文风', 20 * DAY]] }] },
    { topic: topic({ id: 't_bills', kind: 'topic', title: '记账规则', summary: '按流水对账、分类口径、哪几张卡' }, now, 30),
      sections: [{ heading: '口径', lines: [['按流水对账，差异先列出来，不直接改。', 'agreement', '约定 · 10-27', 6 * DAY]] }] },
    { topic: topic({ id: 't_video', kind: 'skill', title: '视频解析', summary: '先用自带字幕，没有再本地转写；要解析视频时读',
      overLimit: true }, now, 10 * 60), sections: [{ heading: '做法', lines: [
        ['先用自带字幕，没有再本地转写。', 'quote', '「抖音样例」· 11-06', 10 * 60]] }] },
  ];
}

export function uncertainSeeds(now: Date): UncertainItem[] {
  const item = (id: string, text: string, basis: string, topicId: string, topicTitle: string,
    minutes: number): UncertainItem => ({ id, text, basis, topicId, topicTitle, inferredAt: minutesAgo(now, minutes),
    status: 'open', correction: null });
  return [
    item('u_weekend', '周末连「等你定」的卡也不想看到，不只是工作提醒。',
      '10-26 原话「周末不要给我排任何工作提醒」；两个周末都没点开卡。', PROACTIVE_DOC_ID, '主动告诉你', 50),
    item('u_commute', '早上 8:30–9:10 是通勤，那段时间首页多给你读的。',
      '近两周这段时间多半在 iPhone 上打开图书。', 't_you', '关于你', 2 * DAY),
    item('u_zhouyu', '周屿更愿意用语音过稿，不想看长文。', '三次采访稿他都回了语音。', 't_zhouyu', '周屿', 3 * DAY),
  ];
}

const SOURCE_KINDS: Readonly<Partial<Record<MemoryDocLine['basis'], MemoryDocLine['sources'][number]['kind']>>> = {
  system: 'system', agreement: 'agreement', tried: 'work' };

export function sectionsOf(seed: TopicSeed, now: Date, idOf: (name: string) => string | null = () => null,
  meta: (line: LineSeed) => { id: string; version: number } | undefined = () => undefined): MemoryDocSection[] {
  return seed.sections.map((section, sectionIndex) => ({
    id: `${seed.topic.id}_s${sectionIndex}`,
    heading: section.heading,
    ...(section.section === undefined ? {} : { section: section.section }),
    lines: section.lines.map((line, lineIndex) => {
      const [text, basis, label, minutes, uncertain, extra] = line;
      return {
        id: meta(line)?.id ?? `${seed.topic.id}_s${sectionIndex}_l${lineIndex}`, version: meta(line)?.version ?? 1,
        text, basis,
        sources: [{ kind: SOURCE_KINDS[basis] ?? 'message',
          id: `src_${seed.topic.id}_${sectionIndex}_${lineIndex}`, label, at: minutesAgo(now, minutes) }],
        uncertainId: uncertain ?? null,
        links: docLinkNames(text).map((name) => ({ name, topicId: idOf(name) })),
        at: minutesAgo(now, minutes),
        ...extra,
      };
    }),
  }));
}
