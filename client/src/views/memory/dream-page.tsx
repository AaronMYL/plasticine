// 「昨晚整理了什么」（《优化清单》第 10、16 条，11-06 定，设计稿 Plasticine-Dream）：夜里的整理读了今天的记录，写进主题文档。
// 一次整理 = 一组变更：新加、替换（旧说法划掉）、拿不准（两个候选，挑一个）、走不通的路。每条带出处，新加 / 替换可撤销。
// 每组先摆 3 条，其余收在「其余 n 条」里。整理逻辑是后面一批；没有整理时记忆页不出现入口，直接打开这页说一句。

import { useEffect, useState, type ReactNode } from 'react';
import type { MemoryDreamChangeView, MemoryDreamView, MemoryLineSource } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { useStore } from '../../state/use-store.ts';
import { Icon, type IconName } from '../../shell/icons.tsx';
import { PageHeader } from '../../shell/page-header.tsx';
import type { Route } from '../../shell/routes.ts';
import './dream.css';

// 每组先摆几条（设计稿）。
const SHOWN = 3;

type Kind = MemoryDreamChangeView['kind'];
const GROUPS: readonly { kind: Kind; title: string; icon: IconName; tone: string; label: string }[] = [
  { kind: 'add', title: '新加', icon: 'plus', tone: 'ok', label: '新加' },
  { kind: 'replace', title: '替换', icon: 'refresh', tone: 'quiet', label: '替换' },
  { kind: 'unsure', title: '拿不准', icon: 'alert', tone: 'plain', label: '拿不准' },
  { kind: 'dead_end', title: '走不通的路', icon: 'close', tone: 'err', label: '走不通' },
];

function dateLine(dream: MemoryDreamView): string {
  const at = new Date(dream.finishedAt);
  const day = `${at.getMonth() + 1}月${at.getDate()}日`;
  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  return `${day} ${time} · 读了 ${dream.linesRead} 条线、${dream.conversationsRead} 段对话`;
}

function Sources({ sources }: { sources: readonly MemoryLineSource[] }): ReactNode {
  if (sources.length === 0) {
    return null;
  }
  return (
    <span className="dream-source text-meta">
      <Icon name="link" size={12} />{sources.map((source) => source.label).join(' · ')}
    </span>
  );
}

function ChangeRow({ change, group }: { change: MemoryDreamChangeView; group: (typeof GROUPS)[number] }): ReactNode {
  const live = useLive();
  const { changeErrors } = useStore(live.memoryTopics.data);
  const error = changeErrors.get(change.id) ?? null;
  const chosen = change.chosen === null ? null : change.candidates[change.chosen];
  return (
    <li className="dream-row" data-undone={change.undone}>
      <span className={`dream-glyph dream-glyph-${group.tone}`} role="img" aria-label={group.label}>
        <Icon name={group.icon} size={13} />
      </span>
      <span className="dream-row-text">
        <span className="dream-row-main">{change.text}</span>
        {change.previous === null ? null : <span className="dream-row-previous text-meta">{change.previous}</span>}
        {change.kind === 'unsure' ? null : <Sources sources={change.sources} />}
        {change.kind === 'unsure' ? <span className="dream-source text-meta">
          {change.candidates.map((candidate) => candidate.sources.map((source) => source.label).join(' · '))
            .join(' · ')}</span> : null}
        {error === null ? null : <span className="dream-row-error text-meta" role="alert">{error}</span>}
      </span>
      <span className="dream-row-actions">
        {change.undone ? <span className="text-meta">已撤销</span> : null}
        {change.canUndo ? <button type="button" className="text-button text-button-quiet"
          aria-label={`撤销「${change.text}」`} onClick={() => void live.memoryTopics.undoChange(change)}>撤销</button>
          : null}
        {change.kind === 'unsure' && change.chosen === null ? change.candidates.map((candidate, index) => (
          <button key={candidate.text} type="button" className="chip-button"
            onClick={() => void live.memoryTopics.chooseChange(change, index === 1 ? 1 : 0)}>{candidate.text}</button>
        )) : null}
        {chosen === null || chosen === undefined ? null : <span className="text-meta">定了：{chosen.text}</span>}
      </span>
    </li>
  );
}

function Group({ group, changes }: { group: (typeof GROUPS)[number]; changes: MemoryDreamChangeView[] }): ReactNode {
  const [open, setOpen] = useState(false);
  if (changes.length === 0) {
    return null;
  }
  const shown = open ? changes : changes.slice(0, SHOWN);
  const rest = changes.length - shown.length;
  return (
    <section className="block memory-block dream-group" aria-labelledby={`dream-${group.kind}`}>
      <div className="memory-block-head">
        <h2 id={`dream-${group.kind}`} className="block-title">{group.title}</h2>
        <span className="block-meta text-mono">{changes.length}</span>
      </div>
      <ul className="dream-rows">
        {shown.map((change) => <ChangeRow key={change.id} change={change} group={group} />)}
      </ul>
      {rest <= 0 ? null : (
        <button type="button" className="dream-more text-meta" aria-expanded={false} onClick={() => setOpen(true)}>
          <Icon name="chevron-down" size={12} />其余 {rest} 条
        </button>
      )}
    </section>
  );
}

export function DreamPage({ navigate, onBack }: { navigate: (route: Route) => void;
  onBack?: (() => void) | undefined; }): ReactNode {
  const live = useLive();
  const { dream, dreamError } = useStore(live.memoryTopics.data);
  useEffect(() => {
    void live.memoryTopics.openDream();
  }, [live.memoryTopics]);
  const back = onBack ?? (() => navigate({ view: 'memory', noteId: null }));
  if (dream === null) {
    return (
      <div className="page memory-dream">
        <PageHeader title="昨晚整理了什么" onBack={back} />
        {dreamError === null ? <p className="block-empty" role="status">正在读…</p>
          : <p className="block-empty" role="alert">{dreamError}</p>}
      </div>
    );
  }
  return (
    <div className="page memory-dream">
      <p className="dream-date text-meta">{dateLine(dream)}</p>
      <PageHeader title={`昨晚整理了 ${dream.changes.length} 条`} onBack={back} />
      {GROUPS.map((group) => <Group key={group.kind} group={group}
        changes={dream.changes.filter((change) => change.kind === group.kind)} />)}
    </div>
  );
}
