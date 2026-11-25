import type { ReactNode } from 'react';
import { DEFAULT_MATE_FACE, DEFAULT_MATE_VARIANT, type LineView, type MateVariant,
  type MateView } from '../../api/shared.ts';
import { useOptionalLive } from '../../live.tsx';
import { Store } from '../../state/store.ts';
import { useStore } from '../../state/use-store.ts';
import type { LinesListData } from '../lines/line-store.ts';
import { BotAvatar } from './bot/bot-avatar.tsx';
import { combinedState, mainLines, mateLines, type BotState, type LinePulse } from './bot/bot-state.ts';
import { useMainVariant } from './main-store.ts';

const NO_LINES = new Store<LinesListData>({ lines: [], loaded: true, error: null });
const NO_PULSE = new Store<ReadonlyMap<string, LinePulse>>(new Map());

function useLinesState(pick: ((lines: readonly LineView[]) => LineView[]) | null): BotState {
  const live = useOptionalLive();
  const { lines } = useStore(live?.lines.list ?? NO_LINES);
  const pulses = useStore(live?.lines.pulse ?? NO_PULSE);
  return pick === null ? 'idle' : combinedState(pick(lines), pulses, Date.now());
}

type MateLook = Pick<MateView, 'avatar' | 'hue'>
  & Partial<Pick<MateView, 'variant' | 'face' | 'id' | 'lineId' | 'disabledAt'>>;

export function MateAvatar({ mate, size = 28, still = false, picked = false }: { mate: MateLook; size?: number;
  still?: boolean; picked?: boolean }): ReactNode {
  const { id, lineId } = mate;
  const state = useLinesState(!still && id !== undefined && lineId !== undefined && mate.disabledAt == null
    ? (lines) => mateLines(lines, { id, lineId }) : null);
  return <BotAvatar look={{ kind: 'mate', character: mate.avatar, hue: mate.hue,
    variant: mate.variant ?? DEFAULT_MATE_VARIANT, face: mate.face ?? DEFAULT_MATE_FACE }} size={size}
    state={picked ? 'done' : state} still={still} />;
}

export function MainAvatar({ size = 28, still = false, variant, picked = false }: { size?: number; still?: boolean;
  variant?: MateVariant; picked?: boolean }): ReactNode {
  const saved = useMainVariant();
  const state = useLinesState(still || picked ? null : mainLines);
  return <BotAvatar look={{ kind: 'main', variant: variant ?? saved }} size={size} state={picked ? 'done' : state}
    still={still} />;
}

export function GroupAvatar({ mates, size = 20 }: { mates: readonly MateView[]; size?: number }): ReactNode {
  return <span className="mate-avatar-stack" aria-hidden="true">
    {mates.slice(0, 3).map((mate) => <MateAvatar key={mate.id} mate={mate} size={size} still />)}
  </span>;
}
