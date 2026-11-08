// 第一次进主线（11-08 设计稿 First-Main / Phone-FirstMain）：建账号时服务端在主线放的欢迎消息（role 是 welcome）。
// Plasticine 标记 + 名字 + 什么时候，下面一段话（一句说清能做什么，后果先问你），再下面几个能点的开始——
// 点了把那一个的 prompt 当他说的话发进这条线。图标名来自服务端，认不出的不画图标。

import { useState, type ReactNode } from 'react';
import type { LineMessageView, WelcomeStart } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { Markdown } from '../../primitives/message/markdown.tsx';
import { Icon, type IconName } from '../../shell/icons.tsx';
import { PlasticineMark } from '../../shell/plasticine-mark.tsx';
import { relativeTime } from '../../shell/relative-time.ts';
import './welcome-message.css';

const START_ICONS: Readonly<Record<string, IconName>> = {
  notes: 'notes',
  note: 'notes',
  feed: 'feed',
  conversation: 'conversation',
  chat: 'conversation',
  books: 'books',
  mail: 'mail',
  globe: 'globe',
  tasks: 'tasks',
  sparkle: 'sparkle',
};

function StartButton({ start, disabled, onStart }: { start: WelcomeStart; disabled: boolean;
  onStart: (start: WelcomeStart) => void }): ReactNode {
  const icon = START_ICONS[start.icon];
  return (
    <button type="button" className="welcome-start" disabled={disabled} onClick={() => onStart(start)}>
      {icon === undefined ? null : <Icon name={icon} size={14} />}
      <span>{start.label}</span>
    </button>
  );
}

export function WelcomeMessage({ lineId, message }: { lineId: string; message: LineMessageView }): ReactNode {
  const live = useLive();
  const [sending, setSending] = useState(false);
  const starts = message.starts ?? [];
  const start = (picked: WelcomeStart): void => {
    if (sending) return;
    setSending(true);
    void live.lines.send(lineId, picked.prompt).finally(() => setSending(false));
  };
  return (
    <article className="welcome-message" aria-label="Plasticine 的欢迎" data-message-seq={message.seq}>
      <header className="welcome-head">
        <PlasticineMark size={20} />
        <span className="welcome-name">Plasticine</span>
        <time className="text-meta welcome-time" dateTime={message.createdAt}>
          {relativeTime(message.createdAt, new Date())}
        </time>
      </header>
      <div className="line-answer welcome-text"><Markdown text={message.text} /></div>
      {starts.length === 0 ? null : (
        <div className="welcome-starts" role="group" aria-label="从哪儿开始">
          {starts.map((item) => <StartButton key={item.id} start={item} disabled={sending} onStart={start} />)}
        </div>
      )}
    </article>
  );
}
