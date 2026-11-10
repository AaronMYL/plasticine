// 官网「功能」那块的五个小演示（11-09 设计稿）：笔记、信息流、图书、资料库、浏览器。每个都能点一下看结果，
// 内容全是写死的，不调 AI。

import { useState, type ReactNode } from 'react';
import { Check } from './collab-demo.tsx';

export type FeatureId = 'notes' | 'feed' | 'book' | 'library' | 'browser';

export const FEATURES: ReadonlyArray<{ id: FeatureId; label: string; title: string; line: string; window: string }> = [
  { id: 'notes', label: '笔记', title: '笔记：选一段，接着写', window: '笔记 · 成都两日',
    line: '选中一段话，Plasticine 接着往下写，或者给几条补充建议。留不留由你定。' },
  { id: 'feed', label: '信息流', title: '信息流：按主题聚在一起', window: '信息流',
    line: '关注的人、论坛和博客，按你在意的主题聚好。同一件事的几条讨论合成一条。' },
  { id: 'book', label: '图书', title: '图书：边读边问', window: '图书 · 桃花源记',
    line: '读到哪儿问到哪儿，回答结合当前这一页；问过的自动记进读书笔记。' },
  { id: 'library', label: '资料库', title: '资料库：做成能看的页面', window: '资料库',
    line: '周报、来信、报告，Plasticine 直接做成排好版的整页，存进资料库。' },
  { id: 'browser', label: '浏览器', title: '浏览器：看到的就能存下', window: '浏览器',
    line: '在 Plasticine 里打开网页，要点提出来，连原网页一起归档。' },
];

const RISE = ['ch-rise', 'ch-rise-2', 'ch-rise-3', 'ch-rise-4'];

function Choices<T extends string>({ items, value, onPick }: { items: ReadonlyArray<readonly [T, string]>;
  value: T | null; onPick: (value: T) => void }): ReactNode {
  return (
    <div className="ch-row" style={{ gap: 8 }}>
      {items.map(([id, label]) => (
        <button key={id} type="button" className="ch-act" aria-pressed={value === id} onClick={() => onPick(id)}>
          {label}</button>
      ))}
    </div>
  );
}

function NotesDemo(): ReactNode {
  const [mode, setMode] = useState<'more' | 'tips' | null>(null);
  return (
    <div className="ch-col ch-rise">
      <div className="ch-note-title">成都两日</div>
      <p className="ch-prose">周六 11:30 出发，阿杰下午才有空。<span className="ch-mark">想把这次写成一篇游记，留给以后翻。</span></p>
      <Choices items={[['more', '续写'], ['tips', '补充建议']] as const} value={mode} onPick={setMode} />
      {mode === 'more' ? <>
        <p className="ch-prose ch-prose-strong ch-rise">
          {'第一天从宽窄巷子开始。下午人多，可以先拐进旁边的小通巷，找家茶铺坐一会儿，等阿杰到了再一起往里走'}
          <span className="ch-caret" /></p>
        <div className="ch-row ch-rise-2" style={{ gap: 8 }}>
          <button type="button" className="ch-act" aria-pressed="true">保留</button>
          <button type="button" className="ch-act">换一种</button>
        </div>
      </> : null}
      {mode === 'tips' ? (
        <ul className="ch-list">
          <li className="ch-item ch-rise"><span className="ch-chip">结构</span><span>按时间写，每天一节</span></li>
          <li className="ch-item ch-rise-2"><span className="ch-chip">补充</span><span>写上住处的位置和价格</span></li>
          <li className="ch-item ch-rise-3">
            <span className="ch-chip ch-chip-blue">联系人</span><span>结尾写写和阿杰的分工</span>
          </li>
        </ul>
      ) : null}
    </div>
  );
}

type Topic = 'ai' | 'indie' | 'chengdu';
const FEEDS: Record<Topic, ReadonlyArray<{ count: string; title: string; sources: readonly string[] }>> = {
  ai: [
    { count: '12', title: '本地跑模型的几种做法', sources: ['X', 'Reddit', '博客'] },
    { count: '7', title: '大家怎么给 AI 写长期记忆', sources: ['X', '博客'] },
    { count: '4', title: '一个人做产品，AI 帮了哪些忙', sources: ['Reddit'] },
  ],
  indie: [
    { count: '9', title: '第一个付费用户是怎么来的', sources: ['X', 'Reddit'] },
    { count: '5', title: '开源以后还怎么赚钱', sources: ['博客', 'X'] },
    { count: '3', title: '定价页改了三版的记录', sources: ['博客'] },
  ],
  chengdu: [
    { count: '6', title: '周末去青城山还是都江堰', sources: ['博客', 'X'] },
    { count: '4', title: '玉林路这几家店还开着吗', sources: ['X'] },
    { count: '3', title: '冬天去成都穿什么', sources: ['博客'] },
  ],
};

function FeedDemo(): ReactNode {
  const [topic, setTopic] = useState<Topic>('ai');
  return (
    <div className="ch-col ch-rise">
      <Choices items={[['ai', 'AI 工具'], ['indie', '独立开发'], ['chengdu', '成都']] as const} value={topic}
        onPick={setTopic} />
      <ul className="ch-list" key={topic} style={{ gap: 8 }}>
        {FEEDS[topic].map((item, index) => (
          <li key={item.title} className={`ch-feed ${RISE[index] ?? ''}`}>
            <span className="ch-feed-count ch-mono">{item.count}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span>{item.title}</span>
              <span className="ch-feed-tags">{item.sources.map((source) => (
                <span key={source} className="ch-chip ch-chip-mute">{source}</span>))}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BookDemo(): ReactNode {
  const [asked, setAsked] = useState(false);
  return (
    <div className="ch-split ch-rise">
      <div className="ch-paper">
        <div className="ch-paper-label">桃花源记 · 第 3 段</div>
        {'既出，得其船，便扶向路，处处志之。及郡下，诣太守，说如此。太守即遣人随其往，寻向所志，'}
        <span className="ch-hl">遂迷，不复得路</span>。
      </div>
      <div className="ch-col" style={{ gap: 10 }}>
        <button type="button" className="ch-act" style={{ alignSelf: 'flex-start' }} aria-pressed={asked}
          onClick={() => setAsked(true)}>为什么找不到路了？</button>
        {asked ? <>
          <div className="ch-bubble ch-bubble-ai ch-rise" style={{ maxWidth: '100%' }}>
            <div className="ch-who">Plasticine</div>
            文中没明说。常见的读法：一路做的记号反而找不回去，桃花源不在刻意去找的路上。</div>
          <div className="ch-saved ch-rise-2">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2h8v12l-4-3-4 3z" fill="none"
              stroke="var(--ch-accent)" strokeWidth="1.5" strokeLinejoin="round" /></svg>
            已记进读书笔记
          </div>
        </> : null}
      </div>
    </div>
  );
}

type Kind = 'weekly' | 'letter' | 'report';
const BAR_HEIGHTS = [40, 65, 35, 80, 55, 92, 30];

function LibraryDemo(): ReactNode {
  const [kind, setKind] = useState<Kind>('weekly');
  return (
    <div className="ch-col ch-rise">
      <Choices items={[['weekly', '周报'], ['letter', '来信'], ['report', '报告']] as const} value={kind} onPick={setKind} />
      {kind === 'weekly' ? (
        <div className="ch-weekly ch-rise">
          <div className="ch-result-head"><strong style={{ fontSize: 'var(--ch-size-card)' }}>本周</strong>
            <span className="ch-sub ch-mono">11.03 – 11.09</span></div>
          <div className="ch-row" style={{ gap: 28, alignItems: 'flex-end', marginTop: 18 }}>
            <div className="ch-bars" aria-hidden="true">{BAR_HEIGHTS.map((height, index) => (
              <i key={index} style={{ height: `${height}%`, animationDelay: `${index * 0.05}s`,
                background: index === 5 ? 'var(--ch-accent)' : undefined }} />))}</div>
            <div className="ch-col" style={{ gap: 4, fontSize: 14, color: 'var(--ch-fg2)' }}>
              <span>写完 3 篇笔记</span><span>读了《桃花源记》</span><span>和阿杰排好了成都行程</span></div>
          </div>
        </div>
      ) : null}
      {kind === 'letter' ? (
        <div className="ch-paper ch-letter ch-rise">
          <div>阿杰：</div>
          <div style={{ textIndent: '2em' }}>
            {'周末的行程排好了。周六十一点半的车，你下午到宽窄巷子找我们就行。青城山那天要走不少路，记得穿双舒服的鞋。'}
          </div>
          <div style={{ textAlign: 'right', marginTop: 12 }}>小林 · 十一月九日</div>
        </div>
      ) : null}
      {kind === 'report' ? (
        <div className="ch-report ch-rise">
          <div className="ch-mono ch-figure-label">报告</div>
          <div style={{ fontSize: 22, fontWeight: 600, marginTop: 4 }}>成都两日 · 花费复盘</div>
          <div className="ch-figures">
            <div><div className="ch-figure ch-mono">1,086</div><div className="ch-figure-label">每人花费（元）</div></div>
            <div><div className="ch-figure ch-mono" style={{ color: 'var(--ch-report-accent)' }}>−9%</div>
              <div className="ch-figure-label">比预算省下</div></div>
            <div><div className="ch-figure ch-mono">38%</div><div className="ch-figure-label">住处占比</div></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const WEB_STEPS = [['0', '浏览'], ['1', '提取'], ['2', '归档']] as const;
type WebStep = (typeof WEB_STEPS)[number][0];

function BrowserDemo(): ReactNode {
  const [step, setStep] = useState<WebStep>('0');
  const marked = step !== '0' ? 'ch-mark' : undefined;
  return (
    <div className="ch-col ch-rise" style={{ gap: 14 }}>
      <div className="ch-address ch-mono">example.com/chengdu-weekend</div>
      <div className="ch-split" style={{ gap: 14 }}>
        <div className="ch-col" style={{ gap: 10, fontSize: 14, lineHeight: 1.7, color: 'var(--ch-fg2)' }}>
          <div style={{ fontSize: 'var(--ch-size-lead)', color: 'var(--ch-fg)', fontWeight: 600 }}>成都周末怎么玩</div>
          <div><span className={marked}>青城山建议早上进山，下午人少但索道排队长。</span></div>
          <div>市区交通以地铁为主，打车高峰较慢。</div>
          <div><span className={marked}>玉林路晚上的小酒馆，周末要提前到。</span></div>
          <div><span className={marked}>宽窄巷子旁的小通巷更安静。</span></div>
        </div>
        <div className="ch-col" style={{ gap: 8 }} key={step}>
          {step === '0' ? <div className="ch-placeholder ch-rise">在 Plasticine 里打开网页</div> : null}
          {step === '1' ? <>
            <div className="ch-mono ch-rise" style={{ fontSize: 12, color: 'var(--ch-accent)' }}>提取到 3 条</div>
            {['早上进青城山', '玉林路周末早点到', '小通巷更安静'].map((text, index) => (
              <div key={text} className={`ch-item ${RISE[index + 1] ?? ''}`} style={{ fontSize: 13 }}>{text}</div>))}
          </> : null}
          {step === '2' ? <>
            <div className="ch-archive ch-rise">
              <div className="ch-mono ch-sub">资料库 · 成都</div>
              <div style={{ fontSize: 15, marginTop: 6 }}>成都周末怎么玩 · 3 条要点</div>
              <div className="ch-row" style={{ gap: 6, marginTop: 10 }}>
                <span className="ch-chip">旅行</span><span className="ch-chip ch-chip-blue">和阿杰共享</span></div>
            </div>
            <div className="ch-done ch-rise-2"><Check />已归档，原网页一起存了</div>
          </> : null}
        </div>
      </div>
      <Choices items={WEB_STEPS} value={step} onPick={setStep} />
    </div>
  );
}

export function FeatureDemo({ id }: { id: FeatureId }): ReactNode {
  switch (id) {
    case 'notes': return <NotesDemo />;
    case 'feed': return <FeedDemo />;
    case 'book': return <BookDemo />;
    case 'library': return <LibraryDemo />;
    case 'browser': return <BrowserDemo />;
  }
}
