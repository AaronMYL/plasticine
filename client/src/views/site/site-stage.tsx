import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { AmbientEngine } from '../../shell/ambient/engine.ts';
import { measureQuiet } from '../../shell/ambient/quiet.ts';

const DEMO_URL = import.meta.env.DEV ? '/demo.html' : '/demo';
const STAGE = { width: 1280, height: 800 };
const NARROW_STAGE = { width: 390, height: 720 };
const NARROW = '(max-width: 720px)';
const PHONE = { width: 390, height: 806, scale: 300 / 390 };
const QUIET_EVERY_MS = 600;
const CIPHER_STEP_MS = 140;
const CIPHER_GLYPHS = 'k7Qz9fXaLm2Pw0YtHs8cVr4nJb6EUd3G';
const CIPHER_LENGTH = 24;
const CIPHER_ROUND = 40;

export const SCENES = [
  { id: 'read', label: '读信息流和来信' },
  { id: 'media', label: '自媒体运营：主线和队友分工' },
  { id: 'notes', label: '笔记续写和建议' },
  { id: 'messages', label: '和朋友的 Plasticine' },
  { id: 'dev', label: '软件开发：队友接力' },
] as const;

export function Sea({ page }: { page: RefObject<HTMLElement | null> }): ReactNode {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    if (element === null) return undefined;
    const engine = new AmbientEngine(element, { figure: 'shark', speed: 1 });
    const measure = (): void => {
      if (page.current !== null) engine.setQuiet(measureQuiet(page.current, element.getBoundingClientRect()));
    };
    measure();
    const timer = window.setInterval(measure, QUIET_EVERY_MS);
    window.addEventListener('scroll', measure, { passive: true });
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('scroll', measure);
      engine.destroy();
    };
  }, [page]);
  return <canvas ref={canvas} className="site-sea" aria-hidden="true" />;
}

const VISIBLE_RATIO = 0.6;
const STAGE_SEEN = 'plasticine-site-stage-seen';
let stageSeen = false;

function useSeen(target: RefObject<HTMLElement | null>): boolean {
  const [seen, setSeen] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const element = target.current;
    if (element === null || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => {
      setSeen(entries.some((entry) => entry.intersectionRatio >= VISIBLE_RATIO));
    }, { threshold: VISIBLE_RATIO });
    observer.observe(element);
    return () => observer.disconnect();
  }, [target]);
  return seen;
}

function useRun(frame: RefObject<HTMLIFrameElement | null>, on: boolean): () => void {
  const tell = useRef<() => void>(() => undefined);
  tell.current = (): void => {
    frame.current?.contentWindow?.postMessage({ plasticineDemo: 'run', on }, window.location.origin);
  };
  useEffect(() => tell.current(), [on]);
  return () => tell.current();
}

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia?.(NARROW).matches === true);
  useEffect(() => {
    const query = window.matchMedia?.(NARROW);
    if (query === undefined) return undefined;
    const listen = (): void => setNarrow(query.matches);
    query.addEventListener('change', listen);
    return () => query.removeEventListener('change', listen);
  }, []);
  return narrow;
}

export function Stage(): ReactNode {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const size = useNarrow() ? NARROW_STAGE : STAGE;
  const seen = useSeen(box);
  const told = useRun(frame, seen);
  useEffect(() => {
    stageSeen = seen;
    window.dispatchEvent(new Event(STAGE_SEEN));
  }, [seen]);
  const [scale, setScale] = useState(1);
  const [scene, setScene] = useState<string>(SCENES[0].id);
  useEffect(() => {
    const element = box.current;
    if (element === null || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => setScale(element.clientWidth / size.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [size]);
  useEffect(() => {
    const listen = (event: MessageEvent<unknown>): void => {
      const data = event.data;
      if (event.source !== frame.current?.contentWindow || typeof data !== 'object' || data === null) return;
      const id: unknown = Reflect.get(data, 'id');
      if (Reflect.get(data, 'plasticineDemo') === 'scene' && typeof id === 'string') setScene(id);
    };
    window.addEventListener('message', listen);
    return () => window.removeEventListener('message', listen);
  }, []);
  const go = (id: string): void => {
    setScene(id);
    frame.current?.contentWindow?.postMessage({ plasticineDemo: 'go', id }, window.location.origin);
  };
  return (
    <div id="stage" className="site-stage-block">
      <div className="site-stage" ref={box} style={{ height: size.height * scale }}>
        <iframe ref={frame} src={DEMO_URL} title="Plasticine 的界面，正在自动演示" width={size.width}
          onLoad={told} height={size.height} style={{ transform: `scale(${scale})` }} />
      </div>
      <div className="site-scenes" role="tablist" aria-label="演示到哪一幕">
        {SCENES.map((item) => (
          <button key={item.id} type="button" role="tab" className="site-scene" aria-selected={item.id === scene}
            onClick={() => go(item.id)}><span className="site-scene-dot" aria-hidden="true" />{item.label}</button>
        ))}
      </div>
    </div>
  );
}

export function PhoneLink(): ReactNode {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const seen = useSeen(box);
  const [stage, setStage] = useState(stageSeen);
  useEffect(() => {
    const listen = (): void => setStage(stageSeen);
    window.addEventListener(STAGE_SEEN, listen);
    return () => window.removeEventListener(STAGE_SEEN, listen);
  }, []);
  const told = useRun(frame, seen && !stage);
  return (
    <div className="site-split">
      <div className="site-phone" ref={box}>
        <iframe ref={frame} onLoad={told} src={`${DEMO_URL}?start=media`} loading="lazy"
          title="手机网页上的 Plasticine，正在自动演示"
          width={PHONE.width} height={PHONE.height} style={{ transform: `scale(${PHONE.scale})` }} />
      </div>
      <div className="site-link" role="img"
        aria-label="手机浏览器直连你的电脑；直连不上时经中继转发，仍是加密的连接">
        <div className="site-node">手机<small>浏览器</small></div>
        <div className="site-wire"><span>直连</span></div>
        <div className="site-node">你的电脑<small>Plasticine</small></div>
        <div className="site-node">手机<small>浏览器</small></div>
        <div className="site-wire" data-kind="relay"><span>直连不上时经中继转发，仍是加密的连接</span></div>
        <div className="site-node">你的电脑<small>Plasticine</small></div>
      </div>
    </div>
  );
}

export function cipherAt(tick: number): string {
  let out = '';
  for (let index = 0; index < CIPHER_LENGTH; index += 1) {
    out += CIPHER_GLYPHS[(index * 7 + tick * 11 + index * tick) % CIPHER_GLYPHS.length];
    if (index % 4 === 3 && index < CIPHER_LENGTH - 1) out += '·';
  }
  return out;
}

export function Cipher({ text }: { text: string }): ReactNode {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true) return undefined;
    const timer = window.setInterval(() => setTick((value) => value + 1), CIPHER_STEP_MS);
    return () => window.clearInterval(timer);
  }, []);
  const beat = tick % CIPHER_ROUND;
  const typed = text.slice(0, Math.min(text.length, beat));
  const sent = beat >= text.length + 2;
  const arrived = beat >= text.length + 14;
  return (
    <div className="site-cipher" role="img" aria-label="一句话在两端是原文，在路上和中继里是密文">
      <div className="site-end"><span className="site-label">你的 Plasticine</span>
        <span className="site-bubble">{tick === 0 ? text : typed}
          <i className="site-caret" data-on={!sent} /></span></div>
      <span className="site-arrow" data-on={sent} aria-hidden="true" />
      <div className="site-end" data-kind="relay"><span className="site-label">中继 · 只转发</span>
        <span className="site-glyphs" data-on={tick === 0 || sent}>{cipherAt(tick)}</span></div>
      <span className="site-arrow" data-on={arrived} aria-hidden="true" />
      <div className="site-end"><span className="site-label">对方的 Plasticine</span>
        <span className="site-bubble" data-on={tick === 0 || arrived}>{text}</span></div>
    </div>
  );
}
