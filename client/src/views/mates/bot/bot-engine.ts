import { useEffect, useState } from 'react';
import type * as BotEngine from '../../../vendor/plasticine-bot/engine.js';
import { installPlasticineFace } from './plasticine-face.ts';

export type Engine = typeof BotEngine;

let loaded: Engine | null = null;
let loading: Promise<Engine> | null = null;

export function loadBotEngine(): Promise<Engine> {
  loading ??= import('../../../vendor/plasticine-bot/engine.js').then((engine) => {
    installPlasticineFace(engine);
    loaded = engine;
    return engine;
  }, (error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

export function botEngine(): Engine | null {
  return loaded;
}

export function useBotEngine(): Engine | null {
  const [engine, setEngine] = useState<Engine | null>(loaded);
  useEffect(() => {
    if (engine !== null) return undefined;
    let alive = true;
    loadBotEngine().then((next) => { if (alive) setEngine(next); }, (error: unknown) => {
      console.error('头像引擎没有加载成功', error);
    });
    return () => { alive = false; };
  }, [engine]);
  return engine;
}
