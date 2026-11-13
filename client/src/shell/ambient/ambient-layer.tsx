// 动态背景这一层（11-13 Aaron「Plasticine 页面背景增加 ASCII 动态背景」）：铺在主区底下、字在它上面，鼠标在页面上划过、
// 点一下都会惊动它。整个关掉就不建；某一页关掉、或者在看网页标签时，停下来淡出，回来接着游（不从头开始）。

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { Route } from '../routes.ts';
import { useStore } from '../../state/use-store.ts';
import { AmbientEngine } from './engine.ts';
import { measureQuiet } from './quiet.ts';
import { ambientPageOf, ambientStore } from './settings.ts';
import './ambient.css';

/** 这个环境画得了：要 canvas 和两个观察器（测试用的 jsdom 没有，就不建）。 */
export function ambientSupported(): boolean {
  return typeof ResizeObserver !== 'undefined' && typeof IntersectionObserver !== 'undefined'
    && typeof window.matchMedia === 'function';
}

export function AmbientLayer({ route, main, suspended }: {
  route: Route;
  /** 主区（会滚动的那个 <main>）：量里面的字在哪。 */
  main: RefObject<HTMLElement | null>;
  /** 在看网页标签、浏览器页：背景被网页盖住，停下来。 */
  suspended: boolean;
}): ReactNode {
  const settings = useStore(ambientStore);
  const visible = settings.enabled && settings.pages[ambientPageOf(route)] && !suspended;
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef(settings);
  latest.current = settings;
  const [engine, setEngine] = useState<AmbientEngine | null>(null);

  useEffect(() => {
    const element = canvas.current;
    if (!settings.enabled || element === null || !ambientSupported()) return undefined;
    const made = new AmbientEngine(element, { figure: latest.current.figure, speed: latest.current.speed });
    setEngine(made);
    return () => {
      made.destroy();
      setEngine(null);
    };
  }, [settings.enabled]);

  useEffect(() => engine?.setFigure(settings.figure), [engine, settings.figure]);
  useEffect(() => engine?.setSpeed(settings.speed), [engine, settings.speed]);
  useEffect(() => engine?.setPaused(!visible), [engine, visible]);
  useQuietText(engine, main, canvas, visible);

  if (!settings.enabled) return null;
  return <canvas ref={canvas} className="ambient-layer" aria-hidden="true" data-visible={visible ? 'true' : undefined}
    style={{ opacity: visible ? settings.opacity : 0 }} />;
}

/** 跟着页面量字：换页、滚动（包括页面里面的滚动区）、改字、改尺寸后重量一次，合并成每 120–400 毫秒最多一次。 */
function useQuietText(engine: AmbientEngine | null, main: RefObject<HTMLElement | null>,
  canvas: RefObject<HTMLCanvasElement | null>, visible: boolean): void {
  useEffect(() => {
    const root = main.current;
    const element = canvas.current;
    if (engine === null || !visible || root === null || element === null) return undefined;
    let timer = 0;
    let frame = 0;
    const measure = (): void => {
      frame = 0;
      engine.setQuiet(measureQuiet(root, element.getBoundingClientRect()));
    };
    const soon = (delay: number): void => {
      if (timer !== 0) return;
      timer = window.setTimeout(() => {
        timer = 0;
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(measure);
      }, delay);
    };
    const onScroll = (): void => soon(120);
    const mutations = new MutationObserver(() => soon(400));
    mutations.observe(root, { subtree: true, childList: true, characterData: true });
    const sizes = new ResizeObserver(() => soon(120));
    sizes.observe(root);
    root.addEventListener('scroll', onScroll, { capture: true, passive: true });
    // 图片加载完会把版面撑开（不换主区大小、也不改 DOM）：load 不冒泡，用捕获接住。
    root.addEventListener('load', onScroll, { capture: true });
    soon(60);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
      mutations.disconnect();
      sizes.disconnect();
      root.removeEventListener('scroll', onScroll, { capture: true });
      root.removeEventListener('load', onScroll, { capture: true });
    };
  }, [engine, main, canvas, visible]);
}
