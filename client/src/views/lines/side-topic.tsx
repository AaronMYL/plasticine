import type { ReactNode } from 'react';
import type { LineTopic } from '../../api/shared.ts';
import { useTimeZone } from '../../live.tsx';
import { HueTile } from '../../shell/hue.tsx';

function dayText(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('zh-CN', { timeZone, month: 'long', day: 'numeric' }).format(new Date(iso));
}

export function SideTopic({ topic }: { topic: LineTopic }): ReactNode {
  const timeZone = useTimeZone();
  const meta = topic.kind === 'feed'
    ? ['信息流', topic.source, topic.at === null ? null : dayText(topic.at, timeZone)]
    : ['主线里的一句'];
  const excerpt = topic.excerpt.split('\n').filter((line) => !line.startsWith('原文：')).join('\n');
  return (
    <article className="line-topic" aria-label="对话来源">
      <div className="line-topic-meta text-meta">
        <HueTile icon={topic.kind === 'feed' ? 'feed' : 'conversation'} hue="sky" size={20} />
        <span>{meta.filter((part) => part !== null).join(' · ')}</span>
      </div>
      {topic.kind === 'feed' ? <p className="line-topic-title">{topic.title}</p> : null}
      {excerpt.trim() === '' ? null : <p className="line-topic-excerpt">{excerpt}</p>}
    </article>
  );
}
