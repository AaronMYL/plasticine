// 一份记忆主题文档（2026-11-02 第 102 条）：活文档，按小节排；每行右边链回原话（对话里那条、笔记那一段、那条约定），
// Plasticine 推断出来的行标「推断」，还在「拿不准的」里的行标「拿不准」。项目那页就是项目档案，顶上有「打开项目」。
// 只读：改记忆走对话（「在对话里提」把这一页带进输入框）。
// 第 4 批：「怎么替你做事」那份最前面是硬线（不管有没有把握都先问你的几类事），一行一个、带锁；下面是规矩。
// 迁来的行出处是那条约定，「约定 ›」已经说了来源，不再挂「约定」标签。
// 第 16、19 条（11-06）：行里的 [[名字]] 是双链，点了打开那一篇；页头能改这一篇的档位（公开 / 合作 / 朋友 / 私密）。

import { useEffect, type ReactNode } from 'react';
import { HARD_LINES_HEADING, HARD_LINES_NOTE, TIER_LABELS, TIERS } from '../../api/shared.ts';
import type { MemoryDocLine, MemoryLineSource, MemoryTopicDoc, MemoryTopicView } from '../../api/shared.ts';
import { Icon } from '../../shell/icons.tsx';
import { InfoTip } from '../../shell/info-tip.tsx';
import { useLive } from '../../live.tsx';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';
import { HueTile } from '../../shell/hue.tsx';
import { PageHeader } from '../../shell/page-header.tsx';
import { mainLineRoute, type Route } from '../../shell/routes.ts';
import { relativeTime } from '../../shell/relative-time.ts';
import { topicLook } from './topics-page.tsx';
import { PhoneContent } from '../reading/phone-content.tsx';
import { memoryTopicQuote } from '../reading/content-quotes.ts';
import './topics.css';

const BASIS_TAG: Readonly<Record<MemoryDocLine['basis'], string | null>> = {
  quote: null,
  agreement: null,
  inferred: '推断',
};

/** 「回到原话」去哪：约定那一段里那一条、对话里那条消息、那篇笔记；图书先到图书馆。 */
function sourceRoute(source: MemoryLineSource): Route {
  switch (source.kind) {
    case 'agreement': return { view: 'memory', noteId: null, objectType: 'agreement', objectId: source.id };
    case 'message': return mainLineRoute(source.id);
    case 'note': return { view: 'notes', noteId: source.id };
    case 'book': return { view: 'books', noteId: null, bookId: source.id };
  }
}

/** 一行的文字：[[名字]] 对得上一篇就是能点的双链，对不上照原样（不带括号）显示。 */
function LineText({ line, navigate }: { line: MemoryDocLine; navigate: (route: Route) => void }): ReactNode {
  const links = new Map((line.links ?? []).map((link) => [link.name, link.topicId]));
  const parts = line.text.split(/(\[\[[^[\]\n]{1,60}\]\])/);
  return parts.map((part, index) => {
    const name = /^\[\[(.+)\]\]$/.exec(part)?.[1]?.trim();
    if (name === undefined) {
      return part;
    }
    const topicId = links.get(name) ?? null;
    return topicId === null ? <span key={index}>{name}</span> : (
      <button key={index} type="button" className="doc-link"
        onClick={() => navigate({ view: 'memory', noteId: null, topicId })}>{name}</button>
    );
  });
}

/** 档位（第 19 条）：默认私密；别人 @ 你的 AI 时只读得到他那一档能看的。 */
function TierControl({ topic }: { topic: MemoryTopicView }): ReactNode {
  const live = useLive();
  const { tierError } = useStore(live.memoryTopics.data);
  return (
    <span className="doc-tier">
      <span className="segmented" role="group" aria-label="档位">
        {[...TIERS].reverse().map((tier) => (
          <button key={tier} type="button" className="segmented-item" aria-pressed={topic.tier === tier}
            onClick={() => { if (tier !== topic.tier) void live.memoryTopics.setTier(topic, tier); }}>
            {TIER_LABELS[tier]}
          </button>
        ))}
      </span>
      <InfoTip label="档位" text="别人 @ 你的 AI 时，只读得到他那一档能看的；群里按最低那一档。归档和今天的记录不对外。" />
      {tierError === null ? null : <span className="text-meta is-error" role="alert">{tierError}</span>}
    </span>
  );
}

function Line({ line, navigate }: { line: MemoryDocLine; navigate: (route: Route) => void }): ReactNode {
  const source = line.sources[0];
  const tag = BASIS_TAG[line.basis];
  return (
    <li className="doc-line" data-basis={line.basis}>
      <span className="doc-line-text">
        <LineText line={line} navigate={navigate} />
        {tag === null ? null : <span className="tag tag-neutral doc-line-tag">{tag}</span>}
        {line.uncertainId === null ? null : <span className="tag tag-outline doc-line-tag">拿不准</span>}
      </span>
      {source === undefined ? null : (
        <button type="button" className="text-button text-button-quiet doc-line-source"
          aria-label={`回到原话：${source.label}`}
          onClick={() => navigate(sourceRoute(source))}>
          {source.label} ›
        </button>
      )}
    </li>
  );
}

/** 硬线：一行一个，带锁；没有出处、不能改（代码里拦着）。 */
function HardLines({ lines }: { lines: readonly string[] }): ReactNode {
  return (
    <section className="doc-section doc-hard" aria-labelledby="doc-hard-title">
      <h2 id="doc-hard-title" className="doc-section-title">
        {HARD_LINES_HEADING}<InfoTip label="先问你的说明" text={HARD_LINES_NOTE} />
      </h2>
      <ul className="doc-hard-lines">
        {lines.map((line) => (
          <li key={line} className="doc-hard-line"><Icon name="lock" size={14} /><span>{line}</span></li>
        ))}
      </ul>
    </section>
  );
}

function Body({ doc, navigate, now, phone = false }: { doc: MemoryTopicDoc; navigate: (route: Route) => void;
  now: Date; phone?: boolean; }): ReactNode {
  const { conversationUi, shellPrefs } = useClientState();
  const look = topicLook(doc.topic);
  const lines = doc.sections.reduce((sum, section) => sum + section.lines.length, 0);
  return (
    <>
      {phone ? null : <div className="doc-head">
        <HueTile hue={look.hue} icon={look.icon} size={32} />
        <p className="doc-summary">{doc.topic.summary}</p>
        <span className="doc-actions">
          {doc.topic.project === null ? null : (
            <button type="button" className="chip-button"
              onClick={() => navigate({ view: 'projects', noteId: null, projectId: doc.topic.project?.id ?? null })}>
              打开项目
            </button>
          )}
          <button type="button" className="chip-button" onClick={() => {
            conversationUi.addQuote(memoryTopicQuote(doc));
            shellPrefs.setChatOpen(true);
          }}>在对话里提</button>
        </span>
      </div>}
      {phone ? null : <p className="doc-meta text-meta">
        {lines} 行 · Plasticine {relativeTime(doc.composedAt, now)}整理{doc.topic.overLimit ? ' · 超出上限，等夜里整理' : ''}
      </p>}
      <TierControl topic={doc.topic} />
      {doc.hardLines === undefined ? null : <HardLines lines={doc.hardLines} />}
      {doc.sections.map((section) => (
        <section key={section.id} className="doc-section" aria-labelledby={section.id}>
          <h2 id={section.id} className="doc-section-title">{section.heading}</h2>
          <ul className="doc-lines">
            {section.lines.map((line) => <Line key={line.id} line={line} navigate={navigate} />)}
          </ul>
        </section>
      ))}
    </>
  );
}

export function TopicDocPage({ topicId, navigate, now = new Date(), phone = false, onBack, route }: {
  topicId: string; navigate: (route: Route) => void; now?: Date; phone?: boolean;
  onBack?: (() => void) | undefined; route?: Route;
}): ReactNode {
  const live = useLive();
  const data = useStore(live.memoryTopics.data);
  useEffect(() => { void live.memoryTopics.openDoc(topicId); }, [live.memoryTopics, topicId]);
  const doc = data.docs.get(topicId) ?? null;
  const error = data.docErrors.get(topicId) ?? null;
  const status = error !== null ? <p className="block-empty is-error" role="alert">
    {error} <button type="button" className="text-button"
      onClick={() => void live.memoryTopics.openDoc(topicId)}>重新读取</button>
  </p> : doc === null ? <p className="block-empty" role="status">正在读…</p> : null;
  if (phone) {
    const target = route ?? { view: 'memory', noteId: null, topicId };
    const look = doc === null ? null : topicLook(doc.topic);
    return <PhoneContent route={target} navigate={navigate} onBack={onBack} ready={doc !== null}
      quote={doc === null ? null : memoryTopicQuote(doc)}>
      <header className="phone-read-title">
        {look === null ? null : <HueTile hue={look.hue} icon={look.icon} size={32} />}
        <h1>{doc?.topic.title ?? '记忆'}</h1><span className="tag tag-neutral">只读</span>
      </header>
      {status}
      {doc === null ? null : <Body doc={doc} navigate={navigate} now={now} phone />}
    </PhoneContent>;
  }
  return (
    <div className="page memory-doc">
      <button type="button" className="text-button text-button-quiet doc-back"
        onClick={() => navigate({ view: 'memory', noteId: null })}>‹ 记忆目录</button>
      <PageHeader title={doc?.topic.title ?? '记忆'} />
      {status}
      {doc === null ? null : <Body doc={doc} navigate={navigate} now={now} />}
    </div>
  );
}
