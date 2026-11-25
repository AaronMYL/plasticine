import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { Route } from '../routes.ts';
import { useStore } from '../../state/use-store.ts';
import { AmbientEngine } from './engine.ts';
import { measureQuiet } from './quiet.ts';
import { ambientPageOf, ambientStore } from './settings.ts';
import './ambient.css';

export function ambientSupported(): boolean {
  return typeof ResizeObserver !== 'undefined' && typeof IntersectionObserver !== 'undefined'
    && typeof window.matchMedia === 'function';
}

export function AmbientLayer({ route, main, suspended }: {
  route: Route;
  main: RefObject<HTMLElement | null>;
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
