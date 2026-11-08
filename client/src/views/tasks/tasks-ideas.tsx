// 任务栏目「建议」（设计稿 Tasks-Ideas，《优化清单》第 4 条）：Plasticine 主动想到的事，一张一行——图标块 · ✦ 做什么 ·
// 为什么现在做 · 开始做 / 加成待办 / 忽略。推测不算他的决定，他点了才算。

import type { ReactNode } from 'react';
import type { SuggestionView } from '../../api/shared.ts';
import { AiMark } from '../../shell/glyph.tsx';
import { HueTile } from '../../shell/hue.tsx';
import { useOpenPanel } from '../../shell/panel.ts';
import { ideaHue, ideaIcon } from './task-format.ts';
import type { TaskActions } from './use-tasks-board.ts';

function Idea({ idea, actions }: { idea: SuggestionView; actions: TaskActions }): ReactNode {
  const openPanel = useOpenPanel();
  const busy = actions.busy === idea.id;
  const start = async (): Promise<void> => {
    const lineId = await actions.suggestion(idea.id, 'start');
    if (lineId !== null) {
      openPanel({ kind: 'work', lineId });
    }
  };
  return (
    <li className="tasks-row tasks-idea" aria-label={`建议：${idea.title}`}>
      <HueTile hue={ideaHue(idea.icon)} icon={ideaIcon(idea.icon)} />
      <div className="tasks-idea-body">
        <span className="tasks-idea-title"><AiMark label="Plasticine 提的" />{idea.title}</span>
        <span className="tasks-row-meta">{idea.why}</span>
        <span className="tasks-idea-actions">
          <button type="button" className="primary-button button-small" disabled={busy}
            onClick={() => void start()}>开始做</button>
          <button type="button" className="secondary-button button-small" disabled={busy}
            onClick={() => void actions.suggestion(idea.id, 'todo')}>加成待办</button>
          <button type="button" className="text-button text-button-quiet" disabled={busy}
            onClick={() => void actions.suggestion(idea.id, 'dismiss')}>忽略</button>
        </span>
        {actions.failed?.id === idea.id ? <p className="tasks-error" role="alert">{actions.failed.text}</p> : null}
      </div>
    </li>
  );
}

export function TasksIdeas({ ideas, actions }: { ideas: SuggestionView[]; actions: TaskActions }): ReactNode {
  if (ideas.length === 0) {
    return <p className="tasks-empty">没有新的建议。</p>;
  }
  return (
    <ul className="tasks-rows" aria-label="建议">
      {ideas.map((idea) => <Idea key={idea.id} idea={idea} actions={actions} />)}
    </ul>
  );
}
