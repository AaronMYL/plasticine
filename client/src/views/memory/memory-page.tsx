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
