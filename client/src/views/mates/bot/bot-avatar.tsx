import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { CharacterController } from '../../../vendor/plasticine-bot/engine.js';
import { BOT_LOOK, type BotState } from './bot-state.ts';
import { useBotEngine } from './bot-engine.ts';
import { engineShape, liveColors, stillSvg, type BotLook } from './bot-render.ts';
import './bot-avatar.css';

const SETTLE_MS = 900;
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
  const { shape, face, variant } = engineShape(look);

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
    const character = engine.createCharacter(element, { shape, face, variant, state: 'idle', seed: shape,
      entryEffects: false, autoPause: true });
    controller.current = character;
    return () => {
      character.destroy();
      controller.current = null;
    };
  }, [live, engine, shape, face, variant]);

  useEffect(() => {
    const character = controller.current;
    if (!live || character === null) return undefined;
    if (state === 'done') {
      character.update({ state: 'idle' });
      character.bounce(0.8);
      character.burst(size < 40 ? 10 : 18);
      return undefined;
    }
    const frame = requestAnimationFrame(() => character.update({ state: BOT_LOOK[state].engine }));
    return () => cancelAnimationFrame(frame);
  }, [live, state, size]);

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
