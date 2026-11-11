// 记忆页（第 102 条；《优化清单》第 16、19、10 条 11-06 重做，设计稿 Plasticine-Memory）：页头「记忆」+ 搜索（含归档）；
// 夜里整理过就有一行「昨晚整理了 n 条」入口（没有整理时整行不出现）；「拿不准的」几条（对 / 不对）；下面是按类型分组的目录：
// 关于你和做事方式 · 项目 · 人 · 话题 · 技能，每篇一行（名字 + 开头那句简介），档位只在不是私密时标出来。

import { InfoTip } from '../../shell/info-tip.tsx';
import { RevealMore } from '../../shell/reveal-more.tsx';
import { FlipList } from '../../shell/flip-list.tsx';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { MEMORY_TOPIC_GROUP_LABELS, TIER_LABELS } from '../../api/shared.ts';
import type { MemoryDreamSummary, MemoryTopicKind, MemoryTopicView, UncertainItem } from '../../api/shared.ts';
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
import { MemoryOverview, TeammatesBlock } from './memory-overview.tsx';
import { uncertainKey } from './topics-store.ts';
import './topics.css';

/** 拿不准的在页面上最多摆几条：用户不会细看记忆（第 102 条）。 */
export const UNCERTAIN_SHOWN_MAX = 3;

const KIND_LOOK: Readonly<Record<MemoryTopicKind, { hue: HueName; icon: IconName }>> = {
  about_you: { hue: 'sage', icon: 'person' },
  rules: { hue: 'ink', icon: 'sliders' },
  person: { hue: 'rose', icon: 'person' },
  project: { hue: 'slate', icon: 'folder' },
  topic: { hue: 'sky', icon: 'hash' },
  skill: { hue: 'ochre', icon: 'tools' },
};

export function topicLook(topic: MemoryTopicView): { hue: HueName; icon: IconName } {
  const look = KIND_LOOK[topic.kind];
  return topic.project === null ? look : { ...look, hue: topic.project.hue };
}

/** 这一条确认操作还没了结时就地的一行：发出中 / 结果待核实 → 再核实 / 没送到 → 重发、不发了 / 被拒 → 原因。 */
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
  // 整节左侧一条细线就是「Plasticine 推断的」；依据在这句后面的 ⓘ 里，对 / 不对常显在行尾，「改一句」收进 ⋯。
  return (
    <li className="uncertain">
      <div className="uncertain-main">
        <p className="uncertain-text"><span>{item.text}<InfoTip label="依据" text={basis} /></span></p>
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
          <button type="button" className="text-button text-button-quiet" onClick={() => setFixing(false)}>算了</button>
        </form>
      ) : null}
      <UncertainOp item={item} />
    </li>
  );
}

/** 档位小签：私密是默认，不标（第 19 条）。 */
export function TierTag({ topic }: { topic: MemoryTopicView }): ReactNode {
  if (topic.tier === 'private') {
    return null;
  }
  return <span className="tag tag-neutral topic-tier" aria-label={`档位：${TIER_LABELS[topic.tier]}`}>
    {TIER_LABELS[topic.tier]}</span>;
}

function TopicRow({ topic, navigate }: { topic: MemoryTopicView; navigate: (route: Route) => void }): ReactNode {
  return (
    <li>
      <button type="button" className="topic-row"
        onClick={() => navigate({ view: 'memory', noteId: null, topicId: topic.id })}>
        <span className="topic-row-text">
          <span className="topic-row-title">{topic.title}</span>
          <span className="topic-row-summary">{topic.summary}</span>
        </span>
        {topic.overLimit ? <span className="topic-row-full text-meta">超出上限</span> : null}
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

/** 「昨晚整理了 n 条」：点开是那一页（#/memory/dream）。 */
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

/** 说法冲突的提示条（11-11）：有没定的才出现，点了去冲突页。 */
function ConflictsEntry({ navigate }: { navigate: (route: Route) => void }): ReactNode {
  const count = useConflicts().data?.conflicts.length ?? 0;
  if (count === 0) return null;
  return <button type="button" className="memory-conflicts" onClick={() => navigate(conflictsRoute())}>
    <Icon name="alert" size={16} /><span className="memory-conflicts-text">{count} 处说法冲突，要你选以哪条为准</span>
    <span className="topic-row-chevron" aria-hidden="true"><Icon name="chevron-right" size={14} /></span>
  </button>;
}

export function TopicsPage({ navigate }: { navigate: (route: Route) => void; now?: Date }): ReactNode {
  const live = useLive();
  const data = useStore(live.memoryTopics.data);
  const [query, setQuery] = useState('');
  useEffect(() => {
    void live.memoryTopics.open();
  }, [live.memoryTopics]);
  const list = data.list;
  const uncertain = list?.uncertain.slice(0, UNCERTAIN_SHOWN_MAX) ?? [];
  const searching = query.trim() !== '';
  return (
    <div className="page memory-topics">
      <PageHeader title="记忆" phoneSearch={false} onBack={() => navigate(mainLineRoute())}
        controls={<MemorySearch.Field value={query} onChange={setQuery} />} />
      {data.error === null ? null : <p className="block-empty is-error" role="alert">{data.error}</p>}
      {searching ? <MemorySearch.Results query={query} navigate={navigate} /> : list === null
        ? <PageLoading /> : (
          <>
            <MemoryOverview navigate={navigate} />
            <ConflictsEntry navigate={navigate} />
            {list.dream === null ? null : <DreamEntry dream={list.dream} navigate={navigate} />}
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
            {list.groups.map((group) => (<Fragment key={group.kind}>
              {group.kind === 'topic' ? <TeammatesBlock navigate={navigate} /> : null}
              <section className="block memory-block topic-group"
                aria-labelledby={`topics-${group.kind}`}>
                <div className="memory-block-head">
                  <h2 id={`topics-${group.kind}`} className="block-title">{MEMORY_TOPIC_GROUP_LABELS[group.kind]}</h2>
                  <span className="block-meta text-mono">{group.topics.length}</span>
                </div>
                <FlipList className="topic-list" keys={group.topics.map((topic) => topic.id)}>
                  {group.topics.map((topic) => <TopicRow key={topic.id} topic={topic} navigate={navigate} />)}
                </FlipList>
              </section>
            </Fragment>))}
            {list.groups.some((group) => group.kind === 'topic') ? null : <TeammatesBlock navigate={navigate} />}
          </>
        )}
    </div>
  );
}
