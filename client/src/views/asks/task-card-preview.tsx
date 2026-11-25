import type { ReactNode } from 'react';
import type { TaskCardPreview as Card } from '../../api/shared.ts';
import { useTimeZone } from '../../live.tsx';
import { Icon } from '../../shell/icons.tsx';
import { FaceAvatar, GroupAvatar } from '../contacts/contact-avatar.tsx';
import { deadlineText } from '../contacts/contact-time.ts';

export function TaskCardPreview({ card }: { card: Card }): ReactNode {
  const timeZone = useTimeZone();
  const deadline = card.deadline === null || Number.isNaN(Date.parse(card.deadline)) ? card.deadline
    : deadlineText(card.deadline, new Date(), timeZone);
  return (
    <div className="line-ask-task">
      <div className="line-ask-task-head">
        {card.to.group ? <GroupAvatar members={[]} avatar={card.to.avatar} size={20} />
          : <FaceAvatar name={card.to.name} avatar={card.to.avatar} size={20} />}
        <span className="line-ask-task-to">{card.to.name}{card.to.group
          ? ` · ${card.assignee === null ? '谁先接谁做' : `指给${card.assignee}`}` : ''}</span>
        {deadline === null ? null : <span className="line-ask-task-due">期限 {deadline}</span>}
      </div>
      <p className="line-ask-task-goal">{card.title === card.goal ? card.goal : `${card.title}，${card.goal}`}</p>
      {card.attachment === null ? null : (
        <span className="line-ask-task-file"><Icon name="paperclip" size={14} />{card.attachment}</span>
      )}
    </div>
  );
}
