// 消息上的署名（11-16 用户定：主线和队友一样，每条回答旁写自己的头像和名字；主线 / 队友之间的话写「谁 → 谁」）。

import type { ReactNode } from 'react';
import type { LineSpeaker } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { useStore } from '../../state/use-store.ts';
import { useMainName } from './main-identity.tsx';
import { MainAvatar, MateAvatar } from './mate-avatar.tsx';

const SIZE = 20;

function One({ speaker }: { speaker: LineSpeaker }): ReactNode {
  const live = useLive();
  const roster = useStore(live.mates.data);
  const mainName = useMainName();
  if (speaker.kind === 'main') {
    return <span className="speaker-one"><MainAvatar size={SIZE} still /><span>{mainName}</span></span>;
  }
  const mate = roster.mates.find((item) => item.id === speaker.id);
  return <span className="speaker-one">
    {mate === undefined ? null : <MateAvatar mate={mate} size={SIZE} still />}<span>{mate?.name ?? '队友'}</span>
  </span>;
}

/** 名字的纯文字（引用署名、读屏）。 */
export function useSpeakerName(speaker: LineSpeaker): string {
  const live = useLive();
  const roster = useStore(live.mates.data);
  const mainName = useMainName();
  return speaker.kind === 'main' ? mainName : roster.mates.find((item) => item.id === speaker.id)?.name ?? '队友';
}

export function Speaker({ speaker, to }: { speaker: LineSpeaker; to?: LineSpeaker | undefined }): ReactNode {
  return <div className="mate-report-author speaker">
    <One speaker={speaker} />
    {to === undefined ? null : <><span className="speaker-arrow" aria-label="交给">→</span><One speaker={to} /></>}
  </div>;
}
