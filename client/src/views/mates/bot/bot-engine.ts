// 角色引擎（client/src/vendor/plasticine-bot/，约 130 KB gzip）按需加载：第一个头像要画时才取，取到后注册主线的泥团
// 和漩涡脸。之后同步可用（botEngine()），组件不用每次等。

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

/** 引擎到了才返回；没到时组件先画占位。取不到（离线时包没缓存）就一直占位，错误打到控制台。 */
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
