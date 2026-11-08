// 侧栏「记忆」：直接是文档目录（主题目录 + 拿不准的，#/memory；11-06 第 16 条加「昨晚整理了什么」#/memory/dream），点开一份主题文档（#/memory/topics/<id>）；目录最前面是
// 「关于你」和「怎么替你做事」两份（第 4 批，11-04 用户定：约定栏换成这份文档）。
// 11-05 用户定：词表撤掉、并进「怎么替你做事」，页头的分段（主题 | 词表）只剩一个，整个去掉。
// 旧地址 #/memory/agreements、#/memory/terms 打开「怎么替你做事」。引用里指向一条约定（#/memory/agreements/<id>，迁进文档
// 的行的出处）、一条词表（#/memory/terms/<id>，同样是迁进来的行的出处，词表也存在约定表里）、一条整理前的原话
// （#/memory/entries/<id>）、一条来源（#/memory/sources/<id>）或一条旧判断（#/memory/judgments/<id>，判断页 2026-11-04
// 撤掉、判断都退役留档）时，单独读那一条。约定表本身不动，那一条的确认、改、撤照旧在那一行上。

import { useState, type ReactNode } from 'react';
import type { Quote } from '../../api/types.ts';
import { PhoneContent } from '../reading/phone-content.tsx';
import { RULES_DOC_ID } from '../../api/shared.ts';
import type { Route } from '../../shell/routes.ts';
import { PageHeader } from '../../shell/page-header.tsx';
import { DreamPage } from './dream-page.tsx';
import { ObjectFocus } from './object-focus.tsx';
import { PendingCognition } from './pending-cognition.tsx';
import { TopicDocPage } from './topic-doc.tsx';
import { TopicsPage } from './topics-page.tsx';
import './memory.css';

export interface MemoryPageProps {
  route: Route;
  phone: boolean;
  navigate: (route: Route) => void;
  onBack?: (() => void) | undefined;
}

/** 单独读一条被引用的约定、词表、原话、来源或旧判断。 */
function ReferencedPage({ type, id, phone, route, navigate, onBack }: MemoryPageProps & {
  type: Route['objectType']; id: string;
}): ReactNode {
  const [quote, setQuote] = useState<Quote | null>(null);
  if (phone) return <PhoneContent route={route} navigate={navigate} onBack={onBack} quote={quote}
    ready={quote !== null}>
    <header className="phone-read-title"><h1>记忆</h1><span className="tag tag-neutral">只读</span></header>
    <ObjectFocus key={`${type}:${id}`} id={id} type={type} readOnly onQuote={setQuote} />
  </PhoneContent>;
  return (
    <div className="page agreements-page">
      <PageHeader title="记忆" />
      {type === 'agreement' ? <PendingCognition /> : null}
      <ObjectFocus key={`${type}:${id}`} id={id} type={type} />
    </div>
  );
}

export function MemoryPage(props: MemoryPageProps): ReactNode {
  const { route, navigate, phone, onBack } = props;
  if (route.termId != null) {
    return <ReferencedPage key={`agreement:${route.termId}`} {...props} type="agreement" id={route.termId} />;
  }
  if (route.memoryDream === true) {
    return <DreamPage navigate={navigate} onBack={onBack} />;
  }
  if (route.topicId != null) {
    return <TopicDocPage topicId={route.topicId} navigate={navigate} phone={phone} onBack={onBack} route={route} />;
  }
  if (route.termId === null || (route.objectType === 'agreement' && route.objectId == null)) {
    return <TopicDocPage topicId={RULES_DOC_ID} navigate={navigate} phone={phone} onBack={onBack} route={route} />;
  }
  if (route.objectId != null && route.objectType !== undefined) {
    return <ReferencedPage key={`${route.objectType}:${route.objectId}`} {...props}
      type={route.objectType} id={route.objectId} />;
  }
  return <TopicsPage navigate={navigate} />;
}
