import { currentComposer } from '../conversation/current-composer.ts';
import { useEffect, type ReactNode } from 'react';
import {
  GRANTS_DOC_ID, HARD_LINES_HEADING, HARD_LINES_NOTE, PROACTIVE_DOC_ID, RULES_DOC_ID, TIER_LABELS, TIERS,
  type MemoryTopicDoc, type MemoryTopicView,
} from '../../api/shared.ts';
import { Icon } from '../../shell/icons.tsx';
import { InfoTip } from '../../shell/info-tip.tsx';
import { useLive } from '../../live.tsx';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';
import { HueTile } from '../../shell/hue.tsx';
import { PageHeader } from '../../shell/page-header.tsx';
import type { Route } from '../../shell/routes.ts';
import { topicLook } from './topics-page.tsx';
import { PhoneContent } from '../reading/phone-content.tsx';
import { memoryTopicQuote } from '../reading/content-quotes.ts';
import { DocLine } from './doc-line.tsx';
import { GrantsPage } from './grants-page.tsx';
import { AddLine, LineActions } from './line-actions.tsx';
import { ProactivePage } from './proactive-page.tsx';
import { PageLoading } from '../../primitives/page-loading/index.tsx';
import './topics.css';
import { timeText } from '../../shell/time-text.ts';

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

export function HardLines({ lines }: { lines: readonly string[] }): ReactNode {
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
  const targetState = useClientState();
  const { shellPrefs } = targetState;
  const look = topicLook(doc.topic);
  const lines = doc.sections.reduce((sum, section) => sum + section.lines.length, 0);
  const how = doc.topic.kind === 'how';
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
            currentComposer(targetState).ui.addQuote(memoryTopicQuote(doc));
            shellPrefs.setChatOpen(true);
          }}>在对话里提</button>
        </span>
      </div>}
      {phone ? null : <p className="doc-meta text-meta">
        {lines} 行 · Plasticine {timeText(doc.composedAt, now)}整理{doc.topic.overLimit ? ' · 超出上限，等夜里整理' : ''}
      </p>}
      {how ? null : <TierControl topic={doc.topic} />}
      {doc.hardLines === undefined ? null : <HardLines lines={doc.hardLines} />}
      {doc.sections.map((section) => (
        <section key={section.id} className="doc-section" aria-labelledby={section.id}>
          <h2 id={section.id} className="doc-section-title">{section.heading}</h2>
          <ul className="doc-lines">
            {section.lines.map((line) => <DocLine key={line.id} line={line} docId={doc.topic.id} navigate={navigate}
              now={now} look={how ? 'how' : 'doc'} {...(doc.topic.id === RULES_DOC_ID ? {} : { actions: (edit) =>
                <LineActions docId={doc.topic.id} line={line} onEdit={edit} /> })} />)}
          </ul>
        </section>
      ))}
      {doc.topic.id === RULES_DOC_ID ? null
        : <AddLine docId={doc.topic.id} {...(how ? { sections: ['do', 'avoid'] as const } : {})} />}
    </>
  );
}

export function TopicDocPage({ topicId, navigate, now = new Date(), phone = false, onBack, route }: {
  topicId: string; navigate: (route: Route) => void; now?: Date; phone?: boolean;
  onBack?: (() => void) | undefined; route?: Route | undefined;
}): ReactNode {
  if (topicId === GRANTS_DOC_ID) {
    return <GrantsPage navigate={navigate} now={now} phone={phone} onBack={onBack} />;
  }
  if (topicId === PROACTIVE_DOC_ID) {
    return <ProactivePage navigate={navigate} now={now} phone={phone} onBack={onBack} />;
  }
  return <PlainDocPage topicId={topicId} navigate={navigate} now={now} phone={phone} onBack={onBack} route={route} />;
}

function PlainDocPage({ topicId, navigate, now, phone, onBack, route }: {
  topicId: string; navigate: (route: Route) => void; now: Date; phone: boolean;
  onBack?: (() => void) | undefined; route?: Route | undefined;
}): ReactNode {
  const live = useLive();
  const data = useStore(live.memoryTopics.data);
  useEffect(() => { void live.memoryTopics.openDoc(topicId); }, [live.memoryTopics, topicId]);
  const doc = data.docs.get(topicId) ?? null;
  const error = data.docErrors.get(topicId) ?? null;
  const status = error !== null ? <p className="block-empty is-error" role="alert">
    {error} <button type="button" className="text-button"
      onClick={() => void live.memoryTopics.openDoc(topicId)}>再读一次</button>
  </p> : doc === null ? <PageLoading /> : null;
  if (phone) {
    const target = route ?? { view: 'memory', noteId: null, topicId };
    const look = doc === null ? null : topicLook(doc.topic);
    return <PhoneContent route={target} navigate={navigate} onBack={onBack} ready={doc !== null}
      quote={doc === null ? null : memoryTopicQuote(doc)}>
      <header className="phone-read-title">
        {look === null ? null : <HueTile hue={look.hue} icon={look.icon} size={32} />}
        <h1>{doc?.topic.title ?? '记忆'}</h1>
      </header>
      {status}
      {doc === null ? null : <Body doc={doc} navigate={navigate} now={now} phone />}
    </PhoneContent>;
  }
  return (
    <div className="page page-read memory-doc">
      <button type="button" className="text-button text-button-quiet doc-back"
        onClick={() => navigate({ view: 'memory', noteId: null })}>‹ 记忆目录</button>
      <PageHeader title={doc?.topic.title ?? '记忆'} />
      {status}
      {doc === null ? null : <Body doc={doc} navigate={navigate} now={now} />}
    </div>
  );
}
