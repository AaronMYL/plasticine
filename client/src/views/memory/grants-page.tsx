import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import {
  GRANTS_DOC_ID, HARD_LINES_NOTE, MEMORY_SECTION_LABELS, memorySectionsOf, type LoopGrantView, type MemoryDocLine,
  type MemoryLineSection, type MemoryTopicDoc,
} from '../../api/shared.ts';
import type { WithdrawnLine } from '../../api/things-client.ts';
import { useLive } from '../../live.tsx';
import { PageLoading } from '../../primitives/page-loading/index.tsx';
import { AiMark } from '../../shell/glyph.tsx';
import { Icon, type IconName } from '../../shell/icons.tsx';
import { InfoTip } from '../../shell/info-tip.tsx';
import { PageHeader } from '../../shell/page-header.tsx';
import { RevealMore } from '../../shell/reveal-more.tsx';
import type { Route } from '../../shell/routes.ts';
import { timeText } from '../../shell/time-text.ts';
import { useStore } from '../../state/use-store.ts';
import { OutboundSettings } from '../settings/outbound-settings.tsx';
import { DocLine, useOpenSource } from './doc-line.tsx';
import { AddLine, GrantLineActions } from './line-actions.tsx';
import { useMemoryEdits } from './use-memory-edits.ts';
import './topics.css';
import './layers.css';

const SECTIONS = memorySectionsOf('grants');
const LEAD: Readonly<Partial<Record<MemoryLineSection, IconName>>> = { allow: 'conversation', ask: 'conversation',
  hold: 'pause' };

function lead(section: MemoryLineSection): ReactNode {
  const icon = LEAD[section];
  return <span className="doc-line-lead" aria-hidden={icon === undefined ? undefined : true}>
    {icon === undefined ? <AiMark label="Plasticine 答应的" /> : <Icon name={icon} size={16} />}</span>;
}

function LoopRow({ grant, now, revoke }: { grant: LoopGrantView; now: Date; revoke: (topic: string) => void }):
  ReactNode {
  return (
    <li className="doc-line doc-line-stacked" data-look="row">
      <span className="doc-line-lead" aria-hidden="true"><Icon name="check" size={16} /></span>
      <span className="doc-line-main">
        <span className="doc-line-text">{grant.topic}</span>
        <span className="doc-line-under text-meta">点过「以后直接做」</span>
      </span>
      <time className="doc-line-at text-meta" dateTime={grant.grantedAt}>{timeText(grant.grantedAt, now)}</time>
      <RevealMore label={`「${grant.topic}」的更多操作`} actions={[
        { icon: 'undo', label: '收回', danger: true, onSelect: () => revoke(grant.topic) },
      ]} />
    </li>
  );
}

function Withdrawn({ lines, live }: { lines: readonly WithdrawnLine[]; live: ReadonlySet<string> }): ReactNode {
  const edits = useMemoryEdits();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = lines.filter((line) => !live.has(line.text));
  if (shown.length === 0) {
    return null;
  }
  return (
    <section className="doc-section grants-gone" aria-label="已收回">
      <button type="button" className="grants-gone-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>已收回</span><span className="text-mono grants-gone-count">{shown.length}</span>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} />
      </button>
      {open ? (
        <ul className="doc-lines">
          {shown.map((line) => (
            <li key={line.id} className="doc-line doc-line-stacked" data-look="row">
              <span className="doc-line-main">
                <span className="doc-line-text grants-gone-text">{line.text}</span>
                <span className="doc-line-under text-meta">原来在「{MEMORY_SECTION_LABELS[line.section]}」</span>
              </span>
              <button type="button" className="text-button" onClick={() =>
                void edits.add(GRANTS_DOC_ID, line.text, line.section).then(setError)}>恢复</button>
            </li>
          ))}
        </ul>
      ) : null}
      {error === null ? null : <p className="text-meta is-error" role="alert">{error}</p>}
    </section>
  );
}

function Body({ doc, navigate, now }: { doc: MemoryTopicDoc; navigate: (route: Route) => void; now: Date }):
  ReactNode {
  const api = useApi();
  const openSource = useOpenSource(navigate);
  const [loop, setLoop] = useState<LoopGrantView[]>([]);
  const [gone, setGone] = useState<WithdrawnLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback((signal?: AbortSignal) => {
    void Promise.all([api.memoryTopics.grants(signal), api.memoryTopics.withdrawn(GRANTS_DOC_ID, signal)])
      .then(([grants, withdrawn]) => {
        if (signal?.aborted !== true) {
          setLoop(grants.loop);
          setGone(withdrawn);
        }
      }, (cause: unknown) => {
        if (signal?.aborted !== true) {
          setError(errorText(cause));
        }
      });
  }, [api]);
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load, doc]);
  const revoke = (topic: string): void => {
    api.memoryTopics.revokeLoopGrant({ requestId: createRequestId(), topic })
      .then((next) => setLoop(next.loop), (cause: unknown) => setError(errorText(cause)));
  };
  const linesOf = (section: MemoryLineSection): MemoryDocLine[] =>
    doc.sections.find((item) => item.section === section)?.lines ?? [];
  const live = new Set(doc.sections.flatMap((section) => section.lines.map((line) => line.text)));
  return (
    <>
      {SECTIONS.map((section) => {
        const lines = linesOf(section);
        const extra = section === 'allow' ? loop : [];
        if (lines.length + extra.length === 0) {
          return null;
        }
        const id = `grants-${section}`;
        return (
          <section key={section} className="doc-section" aria-labelledby={id}>
            <h2 id={id} className="doc-section-title">
              {MEMORY_SECTION_LABELS[section]}
              <span className="text-mono doc-section-count">{lines.length + extra.length}</span>
              {section === 'ask' ? <InfoTip label="先问你的说明"
                text={`${HARD_LINES_NOTE} 那几类一直先问的在设置 · 隐私与授权里，这里是你另外说的。`} /> : null}
            </h2>
            <ul className="doc-lines">
              {lines.map((line) => <DocLine key={line.id} line={line} docId={GRANTS_DOC_ID} navigate={navigate}
                look="row" now={now} lead={lead(section)} actions={(edit) => <GrantLineActions docId={GRANTS_DOC_ID}
                  line={line} section={section} onEdit={edit} onSource={openSource} />} />)}
              {extra.map((grant) => <LoopRow key={grant.id} grant={grant} now={now} revoke={revoke} />)}
            </ul>
          </section>
        );
      })}
      {error === null ? null : <p className="block-empty is-error" role="alert">{error}</p>}
      <AddLine docId={GRANTS_DOC_ID} sections={SECTIONS} />
      <OutboundSettings embedded />
      <Withdrawn lines={gone} live={live} />
    </>
  );
}

export function GrantsPage({ navigate, now, phone, onBack }: { navigate: (route: Route) => void; now: Date;
  phone: boolean; onBack?: (() => void) | undefined }): ReactNode {
  const live = useLive();
  const data = useStore(live.memoryTopics.data);
  useEffect(() => { void live.memoryTopics.openDoc(GRANTS_DOC_ID); }, [live.memoryTopics]);
  const doc = data.docs.get(GRANTS_DOC_ID) ?? null;
  const error = data.docErrors.get(GRANTS_DOC_ID) ?? null;
  const status = error !== null ? <p className="block-empty is-error" role="alert">
    {error} <button type="button" className="text-button"
      onClick={() => void live.memoryTopics.openDoc(GRANTS_DOC_ID)}>再读一次</button>
  </p> : doc === null ? <PageLoading /> : null;
  const body = doc === null ? null : <Body doc={doc} navigate={navigate} now={now} />;
  const back = (): void => navigate({ view: 'memory', noteId: null });
  return (
    <div className="page page-read memory-doc memory-grants">
      {phone ? null : <button type="button" className="text-button text-button-quiet doc-back"
        onClick={back}>‹ 记忆目录</button>}
      <PageHeader title="承诺和授权" phoneSearch={false} onBack={onBack ?? back} />
      {status}
      {body}
    </div>
  );
}
