import { useEffect, type ReactNode } from 'react';
import {
  MEMORY_SECTION_LABELS, PROACTIVE_DOC_ID, type MemoryDocLine, type MemoryLineSection, type MemoryTopicDoc,
} from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { PageLoading } from '../../primitives/page-loading/index.tsx';
import { PageHeader } from '../../shell/page-header.tsx';
import type { Route } from '../../shell/routes.ts';
import { useStore } from '../../state/use-store.ts';
import { DocLine } from './doc-line.tsx';
import { AddLine, LineActions } from './line-actions.tsx';
import { NotifyKindsRows } from './notify-kinds.tsx';
import { RecentBeats, useHeartbeat, WantList, WhenRows } from './proactive-heartbeat.tsx';
import { RecentPushes, usePushes } from './proactive-pushes.tsx';
import './topics.css';
import './layers.css';

interface BlockProps {
  section: 'want' | 'recent' | MemoryLineSection;
  title: string;
  count?: number | undefined;
  children: ReactNode;
}

function Block({ section, title, count, children }: BlockProps): ReactNode {
  const id = `proactive-${section}`;
  return (
    <section className="doc-section" aria-labelledby={id}>
      <h2 id={id} className="doc-section-title">
        {title}
        {count === undefined || count === 0 ? null : <span className="text-mono doc-section-count">{count}</span>}
      </h2>
      {children}
    </section>
  );
}

function Said({ lines, section, navigate, now }: { lines: readonly MemoryDocLine[]; section: MemoryLineSection;
  navigate: (route: Route) => void; now: Date }): ReactNode {
  return (
    <>
      {lines.length === 0 ? null : (
        <ul className="doc-lines">
          {lines.map((line) => <DocLine key={line.id} line={line} docId={PROACTIVE_DOC_ID} navigate={navigate}
            look="row" now={now} actions={(edit) => <LineActions docId={PROACTIVE_DOC_ID} line={line}
              onEdit={edit} />} />)}
        </ul>
      )}
      <AddLine docId={PROACTIVE_DOC_ID} sections={[section]} />
    </>
  );
}

function Body({ doc, navigate, now }: { doc: MemoryTopicDoc; navigate: (route: Route) => void; now: Date }):
  ReactNode {
  const heartbeat = useHeartbeat();
  const { pushes, error: pushesError } = usePushes();
  const beats = heartbeat.view?.recent.length ?? 0;
  const linesOf = (section: MemoryLineSection): MemoryDocLine[] =>
    doc.sections.find((item) => item.section === section)?.lines ?? [];
  const said = (section: MemoryLineSection): ReactNode =>
    <Said lines={linesOf(section)} section={section} navigate={navigate} now={now} />;
  return (
    <div className="proactive-cols">
      <div className="proactive-col">
        <Block section="want" title="想听的" count={heartbeat.view?.config.items.length}>
          <WantList heartbeat={heartbeat} />
          {heartbeat.error === null ? null : <p className="text-meta is-error" role="alert">{heartbeat.error}</p>}
        </Block>
        <Block section="never" title={MEMORY_SECTION_LABELS.never} count={linesOf('never').length}>
          {said('never')}
        </Block>
      </div>
      <div className="proactive-col">
        <Block section="when" title={MEMORY_SECTION_LABELS.when}>
          <WhenRows heartbeat={heartbeat} />
          {said('when')}
        </Block>
        <Block section="style" title={MEMORY_SECTION_LABELS.style}>
          <div className="proactive-rows"><NotifyKindsRows /></div>
          {said('style')}
        </Block>
        {beats === 0 && (pushes ?? []).length === 0 && pushesError === null ? null : (
          <Block section="recent" title="最近">
            <RecentPushes pushes={pushes ?? []} now={now} navigate={navigate} />
            {pushesError === null ? null : <p className="text-meta is-error" role="alert">没读到推送记录：{pushesError}</p>}
            <RecentBeats heartbeat={heartbeat} />
          </Block>
        )}
      </div>
    </div>
  );
}

export function ProactivePage({ navigate, now, phone, onBack }: { navigate: (route: Route) => void; now: Date;
  phone: boolean; onBack?: (() => void) | undefined }): ReactNode {
  const live = useLive();
  const data = useStore(live.memoryTopics.data);
  useEffect(() => { void live.memoryTopics.openDoc(PROACTIVE_DOC_ID); }, [live.memoryTopics]);
  const doc = data.docs.get(PROACTIVE_DOC_ID) ?? null;
  const error = data.docErrors.get(PROACTIVE_DOC_ID) ?? null;
  const status = error !== null ? <p className="block-empty is-error" role="alert">
    {error} <button type="button" className="text-button"
      onClick={() => void live.memoryTopics.openDoc(PROACTIVE_DOC_ID)}>再读一次</button>
  </p> : doc === null ? <PageLoading /> : null;
  const body = doc === null ? null : <Body doc={doc} navigate={navigate} now={now} />;
  const back = (): void => navigate({ view: 'memory', noteId: null });
  return (
    <div className="page memory-doc memory-proactive">
      {phone ? null : <button type="button" className="text-button text-button-quiet doc-back"
        onClick={back}>‹ 记忆目录</button>}
      <PageHeader title="主动告诉你" phoneSearch={false} onBack={onBack ?? back} />
      {status}
      {body}
    </div>
  );
}
