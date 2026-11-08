import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorView, NodeView } from '@tiptap/pm/view';
import { parseNoteChart, type NoteChart } from '../../../../agent/shared/note-chart.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const WIDTH = 480;
const HEIGHT = 240;
const PAD = 32;

function svgTag(name: string, attrs: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) { node.setAttribute(key, String(value)); }
  return node;
}
function label(x: number, y: number, text: string, anchor = 'middle'): SVGElement {
  const node = svgTag('text', { x, y, 'text-anchor': anchor, fill: 'currentColor', 'font-size': 12 });
  node.textContent = text;
  return node;
}
function chartSvg(chart: NoteChart): SVGElement {
  const svg = svgTag('svg', { viewBox: `0 0 ${WIDTH} ${HEIGHT}`, role: 'img',
    'aria-label': chart.title ?? '笔记图表' });
  if (chart.type === 'pie') {
    svg.setAttribute('viewBox', `0 0 ${WIDTH} ${HEIGHT * chart.series.length}`);
    chart.series.forEach((series, seriesIndex) => {
      const group = svgTag('g', { transform: `translate(0 ${HEIGHT * seriesIndex})` });
      group.append(label(120, 20, series.name));
      const total = series.values.reduce((sum, value) => sum + value, 0);
      let angle = -Math.PI / 2;
      series.values.forEach((value, index) => {
        const next = angle + (total === 0 ? 0 : value / total * Math.PI * 2);
        if (value === total && total > 0) {
          group.append(svgTag('circle', { cx: 120, cy: 120, r: 80, fill: 'currentColor', opacity: 0.8 }));
        } else if (value > 0) {
          const start = `${120 + Math.cos(angle) * 80} ${120 + Math.sin(angle) * 80}`;
          const end = `${120 + Math.cos(next) * 80} ${120 + Math.sin(next) * 80}`;
          group.append(svgTag('path', { d: `M120 120 L${start} A80 80 0 ${next - angle > Math.PI ? 1 : 0} 1 ${end} Z`,
            fill: 'currentColor', opacity: 0.25 + index / series.values.length * 0.65 }));
        }
        group.append(label(230, 36 + index * 20, `${chart.labels[index]} · ${value}`, 'start'));
        angle = next;
      });
      if (total === 0) { group.append(label(120, 120, '没有正数数据')); }
      svg.append(group);
    });
    return svg;
  }
  const values = chart.series.flatMap((series) => series.values);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const range = max - min || 1;
  const y = (value: number): number => HEIGHT - PAD - (value - min) / range * (HEIGHT - PAD * 2);
  const step = (WIDTH - PAD * 2) / chart.labels.length;
  const x = (index: number): number => PAD + (index + 0.5) * step;
  svg.append(svgTag('line', { x1: PAD, y1: y(0), x2: WIDTH - PAD, y2: y(0), stroke: 'currentColor', opacity: 0.4 }));
  chart.labels.forEach((text, index) => svg.append(label(x(index), HEIGHT - 10, text)));
  chart.series.forEach((series, seriesIndex) => {
    const opacity = 0.35 + (seriesIndex + 1) / chart.series.length * 0.6;
    const groupWidth = step * 0.7;
    const barWidth = groupWidth / chart.series.length;
    series.values.forEach((value, index) => {
      if (chart.type === 'bar') {
        svg.append(svgTag('rect', { x: x(index) - groupWidth / 2 + seriesIndex * barWidth,
          y: Math.min(y(value), y(0)), width: barWidth * 0.85,
          height: Math.max(1, Math.abs(y(0) - y(value))), fill: 'currentColor', opacity }));
      } else { svg.append(svgTag('circle', { cx: x(index), cy: y(value), r: 3, fill: 'currentColor', opacity })); }
      if (chart.series.length === 1) { svg.append(label(x(index), y(value) - 8, String(value))); }
    });
    if (chart.type === 'line') {
      svg.append(svgTag('polyline', { points: series.values.map((value, index) => `${x(index)},${y(value)}`).join(' '),
        fill: 'none', stroke: 'currentColor', 'stroke-width': 2, opacity,
        'stroke-dasharray': seriesIndex % 2 ? '4 3' : '' }));
    }
    if (series.name) { svg.append(label(PAD + seriesIndex * 120, 14, series.name, 'start')); }
  });
  return svg;
}

function chartNode(node: ProseMirrorNode, view: EditorView, getPos: () => number | undefined): NodeView {
  if (node.attrs['language'] !== 'chart') {
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    pre.append(code);
    return { dom: pre, contentDOM: code,
      update: (next) => next.type === node.type && next.attrs['language'] !== 'chart' };
  }
  const dom = document.createElement('section');
  dom.className = 'note-chart-block';
  dom.contentEditable = 'false';
  let current = node;
  const render = (): void => {
    dom.replaceChildren();
    let parseError: string | null = null;
    try {
      const chart = parseNoteChart(current.textContent);
      if (chart.title) {
        const heading = document.createElement('strong');
        heading.textContent = chart.title;
        dom.append(heading);
      }
      dom.append(chartSvg(chart));
    } catch (cause) { parseError = cause instanceof Error ? cause.message : String(cause); }
    const error = document.createElement('p');
    error.className = 'note-error';
    error.textContent = parseError;
    dom.append(error);
    if (!view.editable) { return; }
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'text-button';
    edit.textContent = '改数据';
    dom.append(edit);
    edit.onclick = () => {
      edit.disabled = true;
      const input = document.createElement('textarea');
      input.setAttribute('aria-label', '图表数据');
      input.value = current.textContent;
      input.rows = 7;
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'chip-button';
      save.textContent = '保存图表';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'text-button';
      cancel.textContent = '取消';
      cancel.onclick = render;
      save.onclick = () => {
        try {
          const chart = parseNoteChart(input.value);
          const pos = getPos();
          if (pos === undefined) { return; }
          view.dispatch(view.state.tr.replaceWith(pos + 1, pos + current.nodeSize - 1,
            view.state.schema.text(JSON.stringify(chart, null, 2))));
        } catch (cause) { error.textContent = cause instanceof Error ? cause.message : String(cause); }
      };
      dom.append(input, save, cancel);
      input.focus();
    };
  };
  render();
  return { dom, stopEvent: () => true, ignoreMutation: () => true,
    update(next) {
      if (next.type !== node.type || next.attrs['language'] !== 'chart') { return false; }
      current = next;
      render();
      return true;
    },
  };
}

export const NoteCharts = Extension.create({
  name: 'noteCharts',
  addProseMirrorPlugins() { return [new Plugin({ props: { nodeViews: { codeBlock: chartNode } } })]; },
});
