import { InfoTip } from '../../shell/info-tip.tsx';
import { RevealMore } from '../../shell/reveal-more.tsx';
import { FlipList } from '../../shell/flip-list.tsx';
import { useEffect, useState, type ReactNode } from 'react';
import {
  MEMORY_TOPIC_GROUP_LABELS, TIER_LABELS, type MemoryDreamSummary, type MemoryTopicKind, type MemoryTopicView,
  type UncertainItem,
} from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { useStore } from '../../state/use-store.ts';
import type { HueName } from '../../shell/hue.tsx';
import { AiMark } from '../../shell/glyph.tsx';
import { Icon, type IconName } from '../../shell/icons.tsx';
import { PageLoading } from '../../primitives/page-loading/index.tsx';
import { useConflicts } from './use-conflicts.ts';
import { PageHeader } from '../../shell/page-header.tsx';
import { conflictsRoute, mainLineRoute, type Route } from '../../shell/routes.ts';
import { OpLine } from '../../primitives/task-row/op-line.tsx';
import { useSignedOps } from '../signing/use-signed-ops.ts';
import { MemorySearch } from './memory-search.tsx';
import { CleanupButton, LayersMoveBanner, MemoryOverview, RulesMoveBanner } from './memory-overview.tsx';
import { useCleanup } from './use-cleanup.ts';
import { uncertainKey } from './topics-store.ts';
import './topics.css';
import './layers.css';

export const UNCERTAIN_SHOWN_MAX = 3;

const KIND_LOOK: Readonly<Record<MemoryTopicKind, { hue: HueName; icon: IconName }>> = {
  about_you: { hue: 'sage', icon: 'person' },
  rules: { hue: 'ink', icon: 'sliders' },
  person: { hue: 'rose', icon: 'person' },
  project: { hue: 'slate', icon: 'folder' },
  topic: { hue: 'sky', icon: 'hash' },
  skill: { hue: 'ochre', icon: 'tools' },
  how: { hue: 'teal', icon: 'tools' },
  grants: { hue: 'ink', icon: 'shield' },
  proactive: { hue: 'ink', icon: 'bell' },
};

const FIXED_KINDS: readonly MemoryTopicKind[] = ['grants', 'proactive'];

export function topicLook(topic: MemoryTopicView): { hue: HueName; icon: IconName } {
  const look = KIND_LOOK[topic.kind];
  return topic.project === null ? look : { ...look, hue: topic.project.hue };
}

function UncertainOp({ item }: { item: UncertainItem }): ReactNode {
  const live = useLive();
  const op = useSignedOps(uncertainKey(item.id)).find((view) => view.status !== 'running');
  if (op === undefined) {
    return null;
  }
  return (
    <OpLine op={op} onRetry={(key) => void live.signer.retry(key)} onDismiss={(key) => live.signer.dismiss(key)} />
  );
}

function UncertainRow({ item }: { item: UncertainItem }): ReactNode {
  const live = useLive();
  const { answered } = useStore(live.memoryTopics.data);
  const [fixing, setFixing] = useState(false);
  const [text, setText] = useState('');
  const status = answered.get(item.id) ?? item.status;
  if (status !== 'open') {
    return (
      <li className="uncertain uncertain-done">
        <span className="text-meta">{status === 'confirmed' ? '已记进' : '已否掉，不记进'}《{item.topicTitle}》</span>
        <span className="uncertain-done-text">{item.text}</span>
      </li>
    );
  }
  const basis = `依据：${item.basis} · 《${item.topicTitle}》`;
  return (
    <li className="uncertain">
      <div className="uncertain-main">
        <p className="uncertain-text"><span>{item.text}<InfoTip label="依据" text={basis} />
          <span className="uncertain-to" aria-label={`打算放进《${item.topicTitle}》`}>
            <Icon name="chevron-right" size={12} />{item.topicTitle}</span></span></p>
        {fixing ? null : (
          <div className="uncertain-answers">
            <button type="button" className="chip-button"
              onClick={() => void live.memoryTopics.answer(item, 'yes')}>没错</button>
            <button type="button" className="chip-button"
              onClick={() => void live.memoryTopics.answer(item, 'no')}>不对</button>
            <RevealMore label={`「${item.text}」的更多操作`} actions={[
              { icon: 'edit', label: '改一句', onSelect: () => setFixing(true) },
            ]} />
          </div>
        )}
      </div>
      {fixing ? (
        <form className="uncertain-fix" onSubmit={(event) => {
          event.preventDefault();
          void live.memoryTopics.answer(item, 'no', text.trim() === '' ? null : text.trim());
        }}>
          <input className="field-input" aria-label="改成一句对的" placeholder="改成一句对的（可不填）" value={text}
            onChange={(event) => setText(event.target.value)} />
          <button type="submit" className="chip-button">记下</button>
          <button type="button" className="text-button text-button-quiet" onClick={() => setFixing(false)}>取消</button>
        </form>
      ) : null}
      <UncertainOp item={item} />
    </li>
  );
}

export function TierTag({ topic }: { topic: MemoryTopicView }): ReactNode {
  if (topic.tier === 'private') {
    return null;
  }
  return <span className="tag tag-neutral topic-tier" aria-label={`档位：${TIER_LABELS[topic.tier]}`}>
    {TIER_LABELS[topic.tier]}</span>;
}

function TopicRow({ topic, navigate }: { topic: MemoryTopicView; navigate: (route: Route) => void }): ReactNode {
  const fixed = FIXED_KINDS.includes(topic.kind);
  return (
    <li>
      <button type="button" className="topic-row"
        onClick={() => navigate({ view: 'memory', noteId: null, topicId: topic.id })}>
        {fixed ? <span className="topic-row-lead" aria-hidden="true">
          <Icon name={KIND_LOOK[topic.kind].icon} size={16} /></span> : null}
        <span className="topic-row-text">
          <span className="topic-row-title">{topic.title}</span>
          {topic.summary === topic.title ? null : <span className="topic-row-summary">{topic.summary}</span>}
        </span>
        {topic.overLimit ? <span className="topic-row-full text-meta">超出上限</span> : null}
        {topic.kind === 'how' ? <span className="topic-row-count text-mono"
          aria-label={`${topic.lineCount} 条`}>{topic.lineCount}</span> : null}
        <TierTag topic={topic} />
        <span className="topic-row-chevron" aria-hidden="true"><Icon name="chevron-right" size={14} /></span>
      </button>
    </li>
  );
}

function dreamCounts(dream: MemoryDreamSummary): string {
  return [['新加', dream.add], ['替换', dream.replace], ['拿不准', dream.unsure]]
    .filter(([, count]) => count !== 0).map(([label, count]) => `${label} ${count}`).join(' · ');
}

function DreamEntry({ dream, navigate }: { dream: MemoryDreamSummary; navigate: (route: Route) => void }):
  ReactNode {
  return (
    <button type="button" className="dream-entry"
      onClick={() => navigate({ view: 'memory', noteId: null, memoryDream: true })}>
      <AiMark label="Plasticine 整理的" />
      <span className="dream-entry-title">昨晚整理了 {dream.total} 条</span>
      <span className="dream-entry-counts text-meta">{dreamCounts(dream)}</span>
      <span className="topic-row-chevron" aria-hidden="true"><Icon name="chevron-right" size={14} /></span>
    </button>
  );
}

function ConflictsEntry({ navigate }: { navigate: (route: Route) => void }): ReactNode {
  const count = useConflicts().data?.conflicts.length ?? 0;
  if (count === 0) return null;
  return <button type="button" className="memory-conflicts" onClick={() => navigate(conflictsRoute())}>
    <span className="dot dot-accent" aria-hidden="true" />
    <span className="memory-conflicts-text">{count} 处说法冲突，要你选以哪条为准</span>
    <span className="topic-row-chevron" aria-hidden="true"><Icon name="chevron-right" size={14} /></span>
  </button>;
}

export function TopicsPage({ navigate }: { navigate: (route: Route) => void; now?: Date }): ReactNode {
  const live = useLive();
  const data = useStore(live.memoryTopics.data);
  const [query, setQuery] = useState('');
  const cleanup = useCleanup();
  const [cleanupError, setCleanupError] = useState<string | null>(null);
  useEffect(() => {
    void live.memoryTopics.open();
  }, [live.memoryTopics]);
  const list = data.list;
  const groups = (list?.groups ?? []).map((group) => ({ ...group, topics: group.topics.filter((topic) =>
    topic.kind !== 'rules'
      && (topic.lineCount > 0 || topic.kind === 'about_you' || FIXED_KINDS.includes(topic.kind))) }))
    .filter((group) => group.topics.length > 0);
  const uncertain = list?.uncertain.slice(0, UNCERTAIN_SHOWN_MAX) ?? [];
  const searching = query.trim() !== '';
  return (
    <div className="page memory-topics">
      <PageHeader title="记忆" phoneSearch={false} onBack={() => navigate(mainLineRoute())}
        controls={<>
          <MemorySearch.Field value={query} onChange={setQuery} />
          <CleanupButton cleanup={cleanup} navigate={navigate} onError={setCleanupError} />
        </>} />
      {data.error === null ? null : <p className="block-empty is-error" role="alert">{data.error}</p>}
      {cleanupError === null ? null : <p className="block-empty is-error" role="alert">{cleanupError}</p>}
      {searching ? <MemorySearch.Results query={query} navigate={navigate} /> : list === null
        ? <PageLoading /> : (
          <>
            <LayersMoveBanner navigate={navigate} />
            <RulesMoveBanner navigate={navigate} />
            <MemoryOverview cleanup={cleanup} navigate={navigate}>
              <ConflictsEntry navigate={navigate} />
              {list.dream === null ? null : <DreamEntry dream={list.dream} navigate={navigate} />}
            </MemoryOverview>
            {uncertain.length === 0 ? null : (
              <section className="block memory-block" aria-labelledby="memory-uncertain">
                <div className="memory-block-head">
                  <h2 id="memory-uncertain" className="block-title">拿不准的</h2>
                  <span className="block-meta text-mono">{list.uncertain.length}</span>
                </div>
                <FlipList className="uncertain-list" keys={uncertain.map((item) => item.id)}>
                  {uncertain.map((item) => <UncertainRow key={item.id} item={item} />)}
                </FlipList>
              </section>
            )}
            {groups.map((group) => (
              <section key={group.kind} className="block memory-block topic-group"
                aria-labelledby={`topics-${group.kind}`}>
                <div className="memory-block-head">
                  <h2 id={`topics-${group.kind}`} className="block-title">{MEMORY_TOPIC_GROUP_LABELS[group.kind]}</h2>
                  {group.kind === 'grants' ? null
                    : <span className="block-meta text-mono">{group.topics.length}</span>}
                </div>
                <FlipList className="topic-list" keys={group.topics.map((topic) => topic.id)}>
                  {group.topics.map((topic) => <TopicRow key={topic.id} topic={topic} navigate={navigate} />)}
                </FlipList>
              </section>
            ))}
          </>
        )}
    </div>
  );
}
