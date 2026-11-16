// 侧栏「记忆」：直接是文档目录（主题目录 + 拿不准的，#/memory；11-06 第 16 条加「昨晚整理了什么」#/memory/dream），点开一份主题文档（#/memory/topics/<id>）；目录最前面是
// 「关于你」和「怎么替你做事」两份（第 4 批，11-04 用户定：约定栏换成这份文档）。
// 11-05 用户定：词表撤掉、并进「怎么替你做事」，页头的分段（主题 | 词表）只剩一个，整个去掉。
// 旧地址 #/memory/agreements、#/memory/terms（带不带哪一条都一样）打开规则搬家：旧约定、旧词表 11-15 退役，表删了。
// 引用里指向一条整理前的原话（#/memory/entries/<id>）时，单独读那一条；来源（#/memory/sources/…）、旧判断
// （#/memory/judgments/…）就是记忆页本身。

import { useState, type ReactNode } from 'react';
import type { Quote } from '../../api/types.ts';
import { PhoneContent } from '../reading/phone-content.tsx';
import { RULES_DOC_ID } from '../../api/shared.ts';
import type { Route } from '../../shell/routes.ts';
import { PageHeader } from '../../shell/page-header.tsx';
import { CleanupPage } from './cleanup-page.tsx';
import { ConflictsPage } from './conflicts-page.tsx';
import { DreamPage } from './dream-page.tsx';
import { RulesMovePage } from './rules-move-page.tsx';
import { ObjectFocus } from './object-focus.tsx';
import { LayersMovePage } from './layers-move-page.tsx';
import { TopicDocPage } from './topic-doc.tsx';
import { TopicsPage } from './topics-page.tsx';
import './memory.css';

export interface MemoryPageProps {
  route: Route;
  phone: boolean;
  navigate: (route: Route) => void;
  onBack?: (() => void) | undefined;
}

/** 单独读一条被引用的旧记忆（整理前的原话）。 */
function ReferencedPage({ id, phone, route, navigate, onBack }: MemoryPageProps & { id: string }): ReactNode {
  const [quote, setQuote] = useState<Quote | null>(null);
  if (phone) return <PhoneContent route={route} navigate={navigate} onBack={onBack} quote={quote}
    ready={quote !== null}>
    <header className="phone-read-title"><h1>记忆</h1><span className="tag tag-neutral">只读</span></header>
    <ObjectFocus key={id} id={id} readOnly onQuote={setQuote} />
  </PhoneContent>;
  return (
    <div className="page page-read memory-entry-page">
      <PageHeader title="记忆" />
      <ObjectFocus key={id} id={id} />
    </div>
  );
}

export function MemoryPage(props: MemoryPageProps): ReactNode {
  const { route, navigate, phone, onBack } = props;
  if (route.memoryDream === true) {
    return <DreamPage navigate={navigate} onBack={onBack} />;
  }
  if (route.memoryConflicts === true) return <ConflictsPage navigate={navigate} onBack={onBack} />;
  if (route.memoryCleanup === true) return <CleanupPage onBack={onBack} />;
  if (route.memoryLayers === true) return <LayersMovePage navigate={navigate} onBack={onBack} />;
  // 规则（原 Soul，11-11）：第13批起是规则搬家——#/memory/rules、只对某位队友的规则、规则那份文档、旧的约定和词表
  // 地址都到这里，勾了的搬进各自的 Soul 或「关于你」。
  if (route.memoryRules === true || route.topicId === RULES_DOC_ID) {
    return <RulesMovePage navigate={navigate} onBack={onBack} />;
  }
  if (route.topicId != null) {
    return <TopicDocPage topicId={route.topicId} navigate={navigate} phone={phone} onBack={onBack} route={route} />;
  }
  if (route.objectId != null && route.objectType === 'memory_entry') {
    return <ReferencedPage key={route.objectId} {...props} id={route.objectId} />;
  }
  return <TopicsPage navigate={navigate} />;
}
