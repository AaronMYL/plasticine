// 空间里的图表（第 6 条：只能用存下来的数据画，图下写数据来源；自己整理的数据标依据）。线图和柱图，一到四组数据，
// 颜色取类别色（--hue-*），没有渐变、没有阴影。读屏名字是图的标题。

import type { ReactNode } from 'react';
import type { SpaceChart } from '../../api/shared.ts';
import { InfoTip } from '../../shell/info-tip.tsx';
import { chartScale } from './chart-scale.ts';
import { sourceHref } from './space-links.ts';

const WIDTH = 560;
const HEIGHT = 180;
const LEFT = 40;
const RIGHT = 20;
const TOP = 12;
const BOTTOM = 30;
const HUES = ['var(--hue-sky)', 'var(--hue-clay)', 'var(--hue-teal)', 'var(--hue-ochre)'];

function label(value: string | number): string {
  return typeof value === 'number' ? String(value) : value;
}

export function SpaceChartView({ chart }: { chart: SpaceChart }): ReactNode {
  const values = chart.series.flatMap((series) => series.values);
  const scale = chartScale(values, chart.kind === 'bar');
  const plotWidth = WIDTH - LEFT - RIGHT;
  const plotHeight = HEIGHT - TOP - BOTTOM;
  const count = chart.x.length;
  const slot = plotWidth / Math.max(count, 1);
  const xOf = (index: number): number => (chart.kind === 'bar' ? LEFT + slot * (index + 0.5)
    : LEFT + (count === 1 ? plotWidth / 2 : (plotWidth * index) / (count - 1)));
  const yOf = (value: number): number => TOP + plotHeight - ((value - scale.min) / (scale.max - scale.min)) * plotHeight;
  const unit = chart.unit ?? '';
  const href = sourceHref(chart.source);
  const barWidth = Math.min(28, (slot * 0.7) / chart.series.length);
  return (
    <figure className="space-chart">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={chart.title}>
        {scale.ticks.map((tick) => <g key={tick}>
          <line x1={LEFT} x2={WIDTH - RIGHT} y1={yOf(tick)} y2={yOf(tick)} className="space-chart-grid" />
          <text x={LEFT - 10} y={yOf(tick) + 4} textAnchor="end" className="space-chart-tick">{tick}{unit}</text>
        </g>)}
        {chart.x.map((value, index) => <text key={`${label(value)}-${index}`} x={xOf(index)} y={HEIGHT - 8}
          textAnchor="middle" className="space-chart-tick">{label(value)}</text>)}
        {chart.series.map((series, seriesIndex) => {
          const color = HUES[seriesIndex % HUES.length];
          if (chart.kind === 'bar') {
            return <g key={series.name} fill={color}>{series.values.map((value, index) => {
              const x = xOf(index) - (barWidth * chart.series.length) / 2 + barWidth * seriesIndex;
              return <rect key={index} x={x} y={yOf(value)} width={barWidth - 2} rx={2}
                height={Math.max(0, yOf(scale.min) - yOf(value))} />;
            })}</g>;
          }
          const path = series.values.map((value, index) => `${index === 0 ? 'M' : 'L'}${xOf(index)} ${yOf(value)}`)
            .join(' ');
          return <g key={series.name}>
            <path d={path} fill="none" stroke={color} strokeWidth={2} />
            {series.values.map((value, index) => <circle key={index} cx={xOf(index)} cy={yOf(value)} r={3.5}
              className="space-chart-point" stroke={color} strokeWidth={2} />)}
          </g>;
        })}
      </svg>
      <figcaption className="text-meta space-chart-caption">
        {chart.series.length > 1 ? <span className="space-chart-legend">{chart.series.map((series, index) => (
          <span key={series.name}><i style={{ background: HUES[index % HUES.length] }} />{series.name}</span>
        ))}</span> : null}
        <span>{chart.caption} · 数据：{chart.source.label}</span>
        {href === null ? null : <a className="space-src" href={href}
          {...(href.startsWith('#') ? {} : { target: '_blank', rel: 'noreferrer' })}>原文</a>}
        {chart.basis === undefined ? null : <InfoTip label="数据怎么整理的" text={chart.basis} />}
      </figcaption>
    </figure>
  );
}
