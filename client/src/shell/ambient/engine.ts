// 把模拟和画接到一块 canvas 上：固定步长的循环、跟着尺寸变、鼠标、看不见就停、系统「减少动态效果」时只画一帧。
// 照 ascii-sharks 的 engine.ts（MIT，见 NOTICE.md），加了换形象、调速度、暂停、正文那一块和换主题重读颜色。

import { figureById, GROUP_PREY, type FigureId } from './figures.ts';
import { readPalette } from './palette.ts';
import type { QuietArea } from './quiet.ts';
import { AsciiRenderer } from './renderer.ts';
import { relocateCritters } from './critters.ts';
import { World } from './world.ts';

const STEP = 1 / 60;
const MAX_STEPS = 6;

export interface EngineOptions {
  figure: FigureId;
  /** 0.25–2，1 是原速。 */
  speed: number;
  /** 颜色从这个元素上的令牌读（默认 <html>）。 */
  tokens?: Element;
  /** 小东西的数量（设置里的小样用很少的一群）；不给按面积算。 */
  moteCount?: number;
  /** 不接鼠标（设置里的小样）。 */
  passive?: boolean;
}

export class AmbientEngine {
  private world: World;
  private readonly renderer: AsciiRenderer;
  private readonly canvas: HTMLCanvasElement;
  private readonly tokens: Element;
  private readonly probe: CanvasRenderingContext2D;
  private readonly options: EngineOptions;
  private figure: FigureId;
  private speed: number;
  private raf = 0;
  private last = 0;
  private acc = 0;
  private visible = true;
  private paused = false;
  private disposed = false;
  private readonly reducedMotion: MediaQueryList;
  private readonly darkScheme: MediaQueryList;
  private readonly resizeObserver: ResizeObserver;
  private readonly intersectionObserver: IntersectionObserver;
  private readonly themeObserver: MutationObserver;

  constructor(canvas: HTMLCanvasElement, options: EngineOptions) {
    this.canvas = canvas;
    this.options = options;
    this.figure = options.figure;
    this.speed = options.speed;
    this.tokens = options.tokens ?? document.documentElement;
    const probe = document.createElement('canvas').getContext('2d');
    if (!probe) throw new Error('2D canvas unavailable');
    this.probe = probe;
    this.renderer = new AsciiRenderer(canvas, readPalette(this.tokens, probe));
    this.renderer.setFontFamily(getComputedStyle(canvas).fontFamily);
    this.world = this.makeWorld();
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.darkScheme = window.matchMedia('(prefers-color-scheme: dark)');
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.intersectionObserver = new IntersectionObserver(([entry]) => {
      this.visible = entry?.isIntersecting ?? true;
      this.schedule();
    });
    this.intersectionObserver.observe(canvas);
    this.themeObserver = new MutationObserver(this.onTheme);
    this.themeObserver.observe(document.documentElement, { attributes: true,
      attributeFilter: ['data-theme', 'data-palette', 'class', 'style'] });
    this.reducedMotion.addEventListener('change', this.onMotionPreference);
    this.darkScheme.addEventListener('change', this.onTheme);
    document.addEventListener('visibilitychange', this.onVisibility);
    if (options.passive !== true) {
      window.addEventListener('pointermove', this.onPointerMove, { passive: true });
      window.addEventListener('pointerdown', this.onPointerDown, { passive: true });
      document.documentElement.addEventListener('pointerleave', this.onPointerLeave);
      window.addEventListener('blur', this.onPointerLeave);
    }
    this.resize();
    // canvas 上的字不会触发网页字体加载；等光栅字体到了再画。
    void document.fonts?.load(`600 16px ${getComputedStyle(canvas).fontFamily}`).then(() => {
      if (!this.disposed && this.still()) this.drawStill();
    });
    this.schedule();
  }

  destroy(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.intersectionObserver.disconnect();
    this.themeObserver.disconnect();
    this.reducedMotion.removeEventListener('change', this.onMotionPreference);
    this.darkScheme.removeEventListener('change', this.onTheme);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerdown', this.onPointerDown);
    document.documentElement.removeEventListener('pointerleave', this.onPointerLeave);
    window.removeEventListener('blur', this.onPointerLeave);
  }

  setFigure(figure: FigureId): void {
    if (figure === this.figure) return;
    this.figure = figure;
    const { quiet, quietRects, quietMeasured } = this.world;
    this.world = this.makeWorld();
    this.world.quiet = quiet;
    this.world.quietRects = quietRects;
    this.world.quietMeasured = quietMeasured;
    this.resize();
    if (this.still()) this.drawStill();
  }

  setSpeed(speed: number): void {
    this.speed = speed;
  }

  /** 这一页不显示：停下循环，回来接着游（不重新开始）。 */
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.schedule();
  }

  /** 字在哪（canvas 坐标）：背景在字后面压淡，大家伙绕着字游。 */
  setQuiet(area: QuietArea | null): void {
    this.world.quiet = area?.bounds ?? null;
    this.world.quietRects = area?.rects ?? [];
    relocateCritters(this.world, !this.world.quietMeasured);
    this.world.quietMeasured = true;
    this.renderer.setQuiet(area?.rects ?? []);
  }

  /** 先空跑几秒再画一帧：设置里的小样、减少动态效果时用。 */
  drawStill(seconds = 4): void {
    for (let i = 0; this.world.time < seconds && i < seconds * 60; i++) this.world.step(STEP);
    this.renderer.render(this.world, STEP);
  }

  private makeWorld(): World {
    const figure = figureById(this.figure);
    this.renderer.setFigure(figure);
    // 只有水流的那个没有小东西。
    const motes = figure.flow === true ? 0 : this.options.moteCount;
    return new World(figure.creatures, GROUP_PREY[figure.group], motes, figure.critters ?? []);
  }

  private still(): boolean {
    return this.reducedMotion.matches || this.options.passive === true;
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.resize(rect.width, rect.height, dpr);
    this.world.resize(rect.width, rect.height, this.renderer.cellWidth, this.renderer.cellHeight);
    if (this.still()) this.drawStill();
  }

  private schedule(): void {
    cancelAnimationFrame(this.raf);
    if (this.disposed || this.paused || !this.visible || document.hidden || this.still()) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private readonly frame = (now: number): void => {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.acc += dt * this.speed;
    let steps = 0;
    while (this.acc >= STEP && steps < MAX_STEPS) {
      this.world.step(STEP);
      this.acc -= STEP;
      steps++;
    }
    if (steps === MAX_STEPS) this.acc = 0;
    this.renderer.render(this.world, dt * this.speed);
    this.raf = requestAnimationFrame(this.frame);
  };

  private readonly onTheme = (): void => {
    this.renderer.setPalette(readPalette(this.tokens, this.probe));
    if (this.still()) this.drawStill();
  };

  private readonly onVisibility = (): void => this.schedule();

  private readonly onMotionPreference = (): void => {
    if (this.still()) {
      cancelAnimationFrame(this.raf);
      this.drawStill();
    } else {
      this.schedule();
    }
  };

  private local(e: PointerEvent): { x: number; y: number; inside: boolean } {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    return { x, y, inside: x >= 0 && y >= 0 && x <= rect.width && y <= rect.height };
  }

  private readonly onPointerMove = (e: PointerEvent): void => {
    const { x, y, inside } = this.local(e);
    const p = this.world.pointer;
    p.x = x;
    p.y = y;
    p.active = inside && e.pointerType !== 'touch' && !this.paused;
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    const { x, y, inside } = this.local(e);
    if (inside && !this.paused && !this.still()) this.world.splash(x, y);
  };

  private readonly onPointerLeave = (): void => {
    this.world.pointer.active = false;
  };
}
