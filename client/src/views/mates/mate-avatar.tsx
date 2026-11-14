// 队友和主线的头像（11-13 Aaron 定）：队友是 Plasticine-bot 的角色加八色之一，画风、脸型可以换；主线是 Plasticine 的
// 泥团、漩涡当脸，画风可以换。
// 有线在做事时按在做什么动（bot/bot-state.ts），平时静止。群组是前三位队友叠在一起，静止的。

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

/** 一组线现在合起来是什么状态；不在 LiveProvider 里（单独画的部件）就是空闲。 */
function useLinesState(pick: ((lines: readonly LineView[]) => LineView[]) | null): BotState {
  const live = useOptionalLive();
  const { lines } = useStore(live?.lines.list ?? NO_LINES);
  const pulses = useStore(live?.lines.pulse ?? NO_PULSE);
  return pick === null ? 'idle' : combinedState(pick(lines), pulses, Date.now());
}

type MateLook = Pick<MateView, 'avatar' | 'hue'>
  & Partial<Pick<MateView, 'variant' | 'face' | 'id' | 'lineId' | 'disabledAt'>>;

/**
 * 队友头像。带着 id 和 lineId 的（名单、对话框、任务……）跟着它的线动；编辑弹框里的预览、现成起点这种没有线的，
 * 或者传了 still 的，只画静止的。picked：编辑时刚挑了这个，弹一下。
 */
export function MateAvatar({ mate, size = 28, still = false, picked = false }: { mate: MateLook; size?: number;
  still?: boolean; picked?: boolean }): ReactNode {
  const { id, lineId } = mate;
  const state = useLinesState(!still && id !== undefined && lineId !== undefined && mate.disabledAt == null
    ? (lines) => mateLines(lines, { id, lineId }) : null);
  return <BotAvatar look={{ kind: 'mate', character: mate.avatar, hue: mate.hue,
    variant: mate.variant ?? DEFAULT_MATE_VARIANT, face: mate.face ?? DEFAULT_MATE_FACE }} size={size}
    state={picked ? 'done' : state} still={still} />;
}

/**
 * 主线头像：主对话和不属于队友的后台事（心跳、做梦、研究员这些例行事也算）有一条在做，它就动。
 * variant：编辑弹框里预览还没保存的画风；picked 同队友。
 */
export function MainAvatar({ size = 28, still = false, variant, picked = false }: { size?: number; still?: boolean;
  variant?: MateVariant; picked?: boolean }): ReactNode {
  const saved = useMainVariant();
  const state = useLinesState(still || picked ? null : mainLines);
  return <BotAvatar look={{ kind: 'main', variant: variant ?? saved }} size={size} state={picked ? 'done' : state}
    still={still} />;
}

export function GroupAvatar({ mates, size = 24 }: { mates: readonly MateView[]; size?: number }): ReactNode {
  return <span className="mate-avatar-stack" aria-hidden="true">
    {mates.slice(0, 3).map((mate) => <MateAvatar key={mate.id} mate={mate} size={size} still />)}
  </span>;
}
