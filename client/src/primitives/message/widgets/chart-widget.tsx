import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { ChartWidget } from '../../../api/shared.ts';
import { chartScale } from '../../chart/chart-scale.ts';

const WIDTH_DEFAULT = 560;
const WIDTH_MIN = 240;
const HEIGHT = 200;
const LEFT = 44;
const RIGHT = 16;
const TOP = 20;
const BOTTOM = 28;
const BAR_MAX = 24;
const HUES = ['var(--hue-sky)', 'var(--hue-clay)', 'var(--hue-teal)', 'var(--hue-ochre)', 'var(--hue-plum)',
  'var(--hue-sage)'];
const PLOT_HEIGHT = HEIGHT - TOP - BOTTOM;
const X_LABEL_SLOT = 44;

interface Hover {
  series: number;
  index: number;
}

interface Mark {
  series: number;
  index: number;
  x: number;
  y: number;
}

type Point = ChartWidget['series'][number]['points'][number];

function text(value: string | number): string {
  return typeof value === 'number' ? String(Number(value.toFixed(4))) : value;
}

function categories(chart: ChartWidget): string[] {
  const seen = new Set<string>();
  for (const series of chart.series) {
    for (const point of series.points) {
      seen.add(text(point.x));
    }
  }
  return [...seen];
}

function numeric(chart: ChartWidget): boolean {
  return chart.series.every((series) => series.points.every((point) => typeof point.x === 'number'));
}

interface Layout {
  width: number;
  ticks: number[];
  yOf: (value: number) => number;
  xOf: (point: Point, index: number) => number;
  xTicks: { label: string; x: number }[];
  slot: number;
}

function layout(chart: ChartWidget, width: number): Layout {
  const plotWidth = width - LEFT - RIGHT;
  const values = chart.series.flatMap((series) => series.points.map((point) => point.y));
  const scale = chartScale(values, chart.type === 'bar');
  const yOf = (value: number): number => TOP + PLOT_HEIGHT
    - ((value - scale.min) / (scale.max - scale.min)) * PLOT_HEIGHT;
  if (chart.type === 'scatter' && numeric(chart)) {
    const xs = chart.series.flatMap((series) => series.points.map((point) => Number(point.x)));
    const xScale = chartScale(xs, false);
    const xOf = (point: Point): number => LEFT
      + ((Number(point.x) - xScale.min) / (xScale.max - xScale.min)) * plotWidth;
    return { width, ticks: scale.ticks, yOf, xOf, slot: 0,
      xTicks: xScale.ticks.map((tick) => ({ label: text(tick), x: xOf({ x: tick, y: 0 }) })) };
  }
  const names = categories(chart);
  const slot = plotWidth / Math.max(names.length, 1);
  const position = (index: number): number => (chart.type === 'bar' ? LEFT + slot * (index + 0.5)
    : LEFT + (names.length === 1 ? plotWidth / 2 : (plotWidth * index) / (names.length - 1)));
  const every = Math.max(1, Math.ceil(names.length / Math.max(1, Math.floor(plotWidth / X_LABEL_SLOT))));
  return { width, ticks: scale.ticks, yOf, slot,
    xOf: (point) => position(names.indexOf(text(point.x))),
    xTicks: names.flatMap((label, index) => (index % every === 0 ? [{ label, x: position(index) }] : [])) };
}

function colorOf(chart: ChartWidget, series: number, index: number, count: number): string {
  if (chart.series.length > 1) {
    return HUES[series % HUES.length] ?? 'var(--hue-sky)';
  }
  return chart.type === 'bar' && index === count - 1 && count > 1 ? 'var(--hue-clay)' : 'var(--hue-sky)';
}

function Bars({ chart, frame, onHover }: { chart: ChartWidget; frame: Layout; onHover: (hover: Hover) => void }):
  ReactNode {
  const groups = chart.series.length;
  const width = Math.min(BAR_MAX, (frame.slot * 0.7) / groups);
  const base = frame.yOf(Math.max(0, frame.ticks[0] ?? 0));
  return chart.series.map((series, s) => <g key={series.name}>{series.points.map((point, index) => {
    const x = frame.xOf(point, index) - (width * groups) / 2 + width * s;
    const top = Math.min(frame.yOf(point.y), base);
    const latest = groups === 1 && index === series.points.length - 1 && series.points.length > 1;
    return <g key={index}>
      <rect x={x + 1} y={top} width={Math.max(1, width - 2)} rx={2}
        height={Math.max(1, Math.abs(base - frame.yOf(point.y)))} fill={colorOf(chart, s, index, series.points.length)}
        onPointerEnter={() => onHover({ series: s, index })} />
      {latest ? <text x={x + width / 2} y={top - 6} textAnchor="middle" className="widget-chart-latest">
        {text(point.y)}</text> : null}
    </g>;
  })}</g>);
}

function Lines({ chart, frame, onHover }: { chart: ChartWidget; frame: Layout; onHover: (hover: Hover) => void }):
  ReactNode {
  return chart.series.map((series, s) => {
    const color = colorOf(chart, s, 0, 0);
    const marks = series.points.map((point, index) => ({ x: frame.xOf(point, index), y: frame.yOf(point.y) }));
    const path = marks.map((mark, index) => `${index === 0 ? 'M' : 'L'}${mark.x} ${mark.y}`).join(' ');
    return <g key={series.name}>
      {chart.type === 'line'
        ? <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        : null}
      {marks.map((mark, index) => <circle key={index} cx={mark.x} cy={mark.y} r={chart.type === 'line' ? 3.5 : 4}
        className="widget-chart-point" stroke={color} strokeWidth={2}
        onPointerEnter={() => onHover({ series: s, index })} />)}
    </g>;
  });
}

function markOf(chart: ChartWidget, frame: Layout, hover: Hover): Mark | null {
  const point = chart.series[hover.series]?.points[hover.index];
  if (point === undefined) {
    return null;
  }
  return { ...hover, x: frame.xOf(point, hover.index), y: frame.yOf(point.y) };
}

function Tip({ chart, mark, width }: { chart: ChartWidget; mark: Mark; width: number }): ReactNode {
  const series = chart.series[mark.series];
  const point = series?.points[mark.index];
  if (series === undefined || point === undefined) {
    return null;
  }
  const left = (mark.x / width) * 100;
  return (
    <div className="widget-chart-tip" role="status"
      style={{ left: `${left}%`, top: `${(mark.y / HEIGHT) * 100}%`,
        transform: `translate(${left > 70 ? 'calc(-100% - 8px)' : '8px'}, -50%)` }}>
      <span className="widget-chart-tip-x">{text(point.x)}{chart.series.length > 1 ? ` · ${series.name}` : ''}</span>
      <span className="widget-chart-tip-y">{text(point.y)}{chart.unit ?? ''}</span>
    </div>
  );
}

function usePlotWidth(): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(WIDTH_DEFAULT);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null || typeof ResizeObserver === 'undefined') return undefined;
    const measure = (): void => {
      const measured = Math.round(element.getBoundingClientRect().width);
      if (measured > 0) setWidth(Math.max(WIDTH_MIN, measured));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

export function ChartWidgetView({ widget }: { widget: ChartWidget }): ReactNode {
  const [hover, setHover] = useState<Hover | null>(null);
  const [plot, width] = usePlotWidth();
  const frame = layout(widget, width);
  const mark = hover === null ? null : markOf(widget, frame, hover);
  const name = [widget.title ?? '图表', ...widget.series.map((series) => series.name)].join('，');
  return (
    <figure className="widget widget-chart" onPointerLeave={() => setHover(null)}>
      {widget.title === undefined ? null : (
        <figcaption className="widget-title">
          {widget.title}{widget.unit === undefined ? null : <span className="widget-chart-unit">（{widget.unit}）</span>}
        </figcaption>
      )}
      <div className="widget-chart-plot" ref={plot}>
        <svg viewBox={`0 0 ${frame.width} ${HEIGHT}`} role="img" aria-label={name}>
          {frame.ticks.map((tick) => {
            const y = frame.yOf(tick);
            return <g key={tick}>
              <line x1={LEFT} x2={frame.width - RIGHT} y1={y} y2={y} className="widget-chart-grid" />
              <text x={LEFT - 8} y={y + 4} textAnchor="end" className="widget-chart-tick">{text(tick)}</text>
            </g>;
          })}
          {frame.xTicks.map((tick, index) => <text key={`${tick.label}-${index}`} x={tick.x} y={HEIGHT - 8}
            textAnchor="middle" className="widget-chart-tick">{tick.label}</text>)}
          {widget.type === 'bar' ? <Bars chart={widget} frame={frame} onHover={setHover} />
            : <Lines chart={widget} frame={frame} onHover={setHover} />}
          {mark === null || widget.type === 'bar' ? null
            : <line x1={mark.x} x2={mark.x} y1={TOP} y2={HEIGHT - BOTTOM} className="widget-chart-cross" />}
        </svg>
        {mark === null ? null : <Tip chart={widget} mark={mark} width={frame.width} />}
      </div>
      {widget.series.length > 1 ? (
        <div className="widget-chart-legend text-meta">{widget.series.map((series, index) => (
          <span key={series.name}><i style={{ background: HUES[index % HUES.length] }} />{series.name}</span>
        ))}</div>
      ) : null}
    </figure>
  );
}
