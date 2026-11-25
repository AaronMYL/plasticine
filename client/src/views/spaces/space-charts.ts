export function spaceCharts(): void {
  const NS = 'http://www.w3.org/2000/svg';
  const HEIGHT = 200;
  const LEFT = 44;
  const RIGHT = 16;
  const TOP = 20;
  const BOTTOM = 28;
  const BAR_MAX = 24;
  const SERIES_MAX = 6;
  const POINTS_MAX = 60;
  const HUES = ['var(--hue-sky)', 'var(--hue-clay)', 'var(--hue-teal)', 'var(--hue-ochre)', 'var(--hue-rose)',
    'var(--hue-sage)'];
  const NICE = [1, 1.5, 2, 2.5, 5, 10];

  interface Point { x: string | number; y: number }
  interface Series { name: string; points: Point[] }
  interface Chart { type: 'bar' | 'line' | 'scatter'; unit: string; series: Series[] }

  const text = (value: string | number): string => (typeof value === 'number' ? String(Number(value.toFixed(4)))
    : value);

  const parse = (raw: string): Chart | null => {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
    if (typeof data !== 'object' || data === null) return null;
    const type = Reflect.get(data, 'type');
    const series = Reflect.get(data, 'series');
    if ((type !== 'bar' && type !== 'line' && type !== 'scatter') || !Array.isArray(series)) return null;
    const clean: Series[] = series.slice(0, SERIES_MAX).map((item: unknown, index: number) => {
      const name = typeof item === 'object' && item !== null ? Reflect.get(item, 'name') : null;
      const points = typeof item === 'object' && item !== null ? Reflect.get(item, 'points') : null;
      return { name: typeof name === 'string' ? name : `第 ${index + 1} 组`,
        points: (Array.isArray(points) ? points : []).slice(0, POINTS_MAX).filter((point: unknown) =>
          typeof point === 'object' && point !== null && typeof Reflect.get(point, 'y') === 'number'
          && ['string', 'number'].includes(typeof Reflect.get(point, 'x')))
          .map((point: object) => ({ x: Reflect.get(point, 'x') as string | number,
            y: Reflect.get(point, 'y') as number })) };
    }).filter((item) => item.points.length > 0);
    const unit = Reflect.get(data, 'unit');
    return clean.length === 0 ? null : { type, unit: typeof unit === 'string' ? unit : '', series: clean };
  };

  const scale = (values: number[], fromZero: boolean): { ticks: number[]; min: number; max: number } => {
    const low = Math.min(...values, ...(fromZero ? [0] : []));
    const high = Math.max(...values);
    const raw = (high - low) / 2;
    const power = raw <= 0 ? 1 : 10 ** Math.floor(Math.log10(raw));
    const step = raw <= 0 ? 1 : (NICE.find((factor) => factor * power >= raw - 1e-9) ?? 10) * power;
    const unit = 10 ** Math.floor(Math.log10(step)) / 2;
    const first = Math.floor(low / unit) * unit;
    const ticks = [0, 1, 2].map((index) => Number((first + index * step).toFixed(6)));
    const top = Math.max(ticks[2] ?? high, high);
    return { ticks, min: first, max: top === first ? first + 1 : top };
  };

  const node = (tag: string, attributes: Record<string, string | number>, parent: Element): SVGElement => {
    const element = document.createElementNS(NS, tag);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
    parent.appendChild(element);
    return element;
  };

  const draw = (host: HTMLElement, chart: Chart): void => {
    const width = Math.max(240, Math.round(host.getBoundingClientRect().width) || 560);
    host.replaceChildren();
    const plot = document.createElement('div');
    plot.className = 'pz-chart-plot';
    host.appendChild(plot);
    const svg = node('svg', { viewBox: `0 0 ${width} ${HEIGHT}`, role: 'img',
      'aria-label': chart.series.map((series) => series.name).join('，') }, plot);
    const tip = document.createElement('div');
    tip.className = 'pz-chart-tip';
    tip.hidden = true;
    plot.appendChild(tip);
    const plotWidth = width - LEFT - RIGHT;
    const plotHeight = HEIGHT - TOP - BOTTOM;
    const y = scale(chart.series.flatMap((series) => series.points.map((point) => point.y)), chart.type === 'bar');
    const yOf = (value: number): number => TOP + plotHeight - ((value - y.min) / (y.max - y.min)) * plotHeight;
    for (const tick of y.ticks) {
      node('line', { x1: LEFT, x2: width - RIGHT, y1: yOf(tick), y2: yOf(tick), class: 'pz-chart-grid' }, svg);
      node('text', { x: LEFT - 8, y: yOf(tick) + 4, 'text-anchor': 'end', class: 'pz-chart-tick' }, svg)
        .textContent = text(tick);
    }
    const numeric = chart.series.every((series) => series.points.every((point) => typeof point.x === 'number'));
    let xOf: (point: Point) => number;
    let slot = 0;
    if (chart.type === 'scatter' && numeric) {
      const x = scale(chart.series.flatMap((series) => series.points.map((point) => Number(point.x))), false);
      xOf = (point) => LEFT + ((Number(point.x) - x.min) / (x.max - x.min)) * plotWidth;
      for (const tick of x.ticks) {
        node('text', { x: xOf({ x: tick, y: 0 }), y: HEIGHT - 8, 'text-anchor': 'middle', class: 'pz-chart-tick' }, svg)
          .textContent = text(tick);
      }
    } else {
      const names = [...new Set(chart.series.flatMap((series) => series.points.map((point) => text(point.x))))];
      slot = plotWidth / Math.max(names.length, 1);
      const position = (index: number): number => (chart.type === 'bar' ? LEFT + slot * (index + 0.5)
        : LEFT + (names.length === 1 ? plotWidth / 2 : (plotWidth * index) / (names.length - 1)));
      xOf = (point) => position(names.indexOf(text(point.x)));
      const every = Math.max(1, Math.ceil(names.length / Math.max(1, Math.floor(plotWidth / 44))));
      names.forEach((name, index) => {
        if (index % every === 0) {
          node('text', { x: position(index), y: HEIGHT - 8, 'text-anchor': 'middle', class: 'pz-chart-tick' }, svg)
            .textContent = name;
        }
      });
    }
    const show = (series: Series, point: Point, left: number, top: number): void => {
      tip.hidden = false;
      tip.textContent = '';
      const label = document.createElement('span');
      label.textContent = text(point.x) + (chart.series.length > 1 ? ` · ${series.name}` : '');
      const value = document.createElement('b');
      value.textContent = text(point.y) + chart.unit;
      tip.append(label, value);
      const percent = (left / width) * 100;
      tip.style.left = `${percent}%`;
      tip.style.top = `${(top / HEIGHT) * 100}%`;
      tip.style.transform = `translate(${percent > 70 ? 'calc(-100% - 8px)' : '8px'}, -50%)`;
    };
    host.addEventListener('pointerleave', () => {
      tip.hidden = true;
    });
    const single = chart.series.length === 1;
    const groups = chart.series.length;
    const barWidth = Math.min(BAR_MAX, (slot * 0.7) / groups);
    const base = yOf(Math.max(0, y.ticks[0] ?? 0));
    chart.series.forEach((series, s) => {
      const color = HUES[s % HUES.length] ?? 'var(--hue-sky)';
      if (chart.type === 'bar') {
        series.points.forEach((point, index) => {
          const latest = single && index === series.points.length - 1 && series.points.length > 1;
          const x = xOf(point) - (barWidth * groups) / 2 + barWidth * s;
          const top = Math.min(yOf(point.y), base);
          const bar = node('rect', { x: x + 1, y: top, width: Math.max(1, barWidth - 2), rx: 2,
            height: Math.max(1, Math.abs(base - yOf(point.y))),
            fill: single ? (latest ? 'var(--hue-clay)' : 'var(--hue-sky)') : color }, svg);
          bar.addEventListener('pointerenter', () => show(series, point, x + barWidth / 2, top));
          if (latest) {
            node('text', { x: x + barWidth / 2, y: top - 6, 'text-anchor': 'middle', class: 'pz-chart-latest' }, svg)
              .textContent = text(point.y);
          }
        });
        return;
      }
      if (chart.type === 'line') {
        node('path', { d: series.points.map((point, index) => `${index === 0 ? 'M' : 'L'}${xOf(point)} ${yOf(point.y)}`)
          .join(' '), fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round',
        'stroke-linecap': 'round' }, svg);
      }
      for (const point of series.points) {
        const dot = node('circle', { cx: xOf(point), cy: yOf(point.y), r: chart.type === 'line' ? 3.5 : 4,
          class: 'pz-chart-point', stroke: color, 'stroke-width': 2 }, svg);
        dot.addEventListener('pointerenter', () => show(series, point, xOf(point), yOf(point.y)));
      }
    });
    if (chart.series.length > 1) {
      const legend = document.createElement('div');
      legend.className = 'pz-chart-legend';
      chart.series.forEach((series, index) => {
        const item = document.createElement('span');
        const swatch = document.createElement('i');
        swatch.style.background = HUES[index % HUES.length] ?? 'var(--hue-sky)';
        item.append(swatch, series.name);
        legend.appendChild(item);
      });
      host.appendChild(legend);
    }
  };

  const render = (host: HTMLElement): void => {
    const chart = parse(host.dataset['chart'] ?? '');
    if (chart === null) {
      host.textContent = '图表的数据写错了（要 type、series，每组有 points）。';
      host.classList.add('pz-chart-bad');
      return;
    }
    draw(host, chart);
    if (typeof ResizeObserver !== 'undefined') {
      let width = host.getBoundingClientRect().width;
      new ResizeObserver(() => {
        const next = host.getBoundingClientRect().width;
        if (Math.abs(next - width) >= 1) {
          width = next;
          draw(host, chart);
        }
      }).observe(host);
    }
  };

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll<HTMLElement>('.pz-chart[data-chart]').forEach(render);
  });
}
