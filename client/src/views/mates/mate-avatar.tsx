import type { CSSProperties, ReactNode } from 'react';
import type { MateView } from '../../api/shared.ts';
import { hueVar } from '../../shell/hue.tsx';

export function MateAvatar({ mate, size = 28 }: { mate: Pick<MateView, 'avatar' | 'hue'>; size?: number }): ReactNode {
  return <span className="hue-tile mate-avatar" aria-hidden="true"
    style={{ '--tile-hue': hueVar(mate.hue), width: size, height: size } as CSSProperties}>{mate.avatar}</span>;
}

export function GroupAvatar({ mates }: { mates: readonly MateView[] }): ReactNode {
  return <span className="mate-avatar-stack" aria-hidden="true">
    {mates.slice(0, 3).map((mate) => <MateAvatar key={mate.id} mate={mate} size={24} />)}
  </span>;
}
