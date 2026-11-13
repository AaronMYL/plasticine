// 队友、主线的头像（11-13 Aaron 定）：平时是静止的一张；线在做事时用引擎的动效，按在做什么换（见 bot-state.ts）；
// 回到空闲、暂停时让动作落定再换回静止的一张；做完弹一下、撒把彩纸再静止。系统设了减少动态效果就只画静止的
// （那一刻的样子，等你、出错的小图标还在）。引擎还没加载到时占一个同样大的位置。

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { CharacterController } from '../../../vendor/plasticine-bot/engine.js';
import { BOT_LOOK, type BotState } from './bot-state.ts';
import { useBotEngine } from './bot-engine.ts';
import { engineShape, liveColors, stillSvg, type BotLook } from './bot-render.ts';
import './bot-avatar.css';

/** 从动到静：等动作落定再换成静止的那一张。 */
const SETTLE_MS = 900;
/** 做完那一下（弹一下、撒彩纸）放多久。 */
const CELEBRATE_MS = 1_700;

function useReducedMotion(): boolean {
  const [query] = useState(() => (typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)') : null));
  const [reduced, setReduced] = useState(query?.matches ?? false);
  useEffect(() => {
    if (query === null) return undefined;
    const change = (): void => setReduced(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, [query]);
  return reduced;
}

export interface BotAvatarProps {
  look: BotLook;
  size: number;
  state?: BotState;
  /** 只画静止的（记忆里的小签、报告署名这类不需要看状态的地方）。 */
  still?: boolean;
}

export function BotAvatar({ look, size, state = 'idle', still = false }: BotAvatarProps): ReactNode {
  const engine = useBotEngine();
  const reduced = useReducedMotion();
  const animate = engine !== null && !still && !reduced;
  const moving = BOT_LOOK[state].moving || state === 'done';
  const [live, setLive] = useState(false);
  const host = useRef<HTMLSpanElement>(null);
  const controller = useRef<CharacterController | null>(null);
  const { shape, face } = engineShape(look);

  // 动起来立刻换；停下来等落定。
  useEffect(() => {
    if (!animate) {
      setLive(false);
      return undefined;
    }
    if (moving) {
      setLive(true);
      if (state !== 'done') return undefined;
    }
    const timer = setTimeout(() => setLive(false), state === 'done' ? CELEBRATE_MS : SETTLE_MS);
    return () => clearTimeout(timer);
  }, [animate, moving, state]);

  useLayoutEffect(() => {
    const element = host.current;
    if (!live || engine === null || element === null) return undefined;
    const character = engine.createCharacter(element, { shape, face, state: 'idle', seed: shape,
      entryEffects: false, autoPause: true });
    controller.current = character;
    return () => {
      character.destroy();
      controller.current = null;
    };
  }, [live, engine, shape, face]);

  useEffect(() => {
    const character = controller.current;
    if (!live || character === null) return undefined;
    if (state === 'done') {
      character.update({ state: 'idle' });
      character.bounce(0.8);
      character.burst(size < 40 ? 10 : 18);
      return undefined;
    }
    // 先按空闲画一帧，再换到这个状态：从静止的那一张平滑地动起来。
    const frame = requestAnimationFrame(() => character.update({ state: BOT_LOOK[state].engine }));
    return () => cancelAnimationFrame(frame);
  }, [live, state, size]);

  // 静止的那一张：平时动的状态在动起来之前先画空闲；不动的时候（减少动态效果、只要静止）画这个状态那一刻的样子。
  const resting = still || reduced || !BOT_LOOK[state].moving ? BOT_LOOK[state].engine : 'idle';
  const svg = useMemo(() => (engine === null || live ? null : stillSvg(engine, look, resting, size)),
    [engine, live, look, resting, size]);
  const box: CSSProperties = { width: size, height: size };
  if (engine === null) {
    const tint = { '--tile-hue': look.kind === 'main' ? 'var(--accent)' : `var(--hue-${look.hue})` } as CSSProperties;
    return <span className="bot-avatar bot-avatar-wait" aria-hidden="true" style={{ ...box, ...tint }} />;
  }
  if (live) {
    return <span className="bot-avatar" aria-hidden="true" data-state={state}
      style={{ ...box, ...liveColors(look) }} ref={host} />;
  }
  return <span className="bot-avatar" aria-hidden="true" data-state={state} style={box}
    dangerouslySetInnerHTML={{ __html: svg ?? '' }} />;
}
