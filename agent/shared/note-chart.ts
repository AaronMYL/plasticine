import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';

const ChartBase = {
  type: Type.Enum(['bar', 'line', 'pie']), title: Type.Optional(Type.String()),
  labels: Type.Array(Type.String(), { minItems: 1 }),
};
const SeriesSchema = Type.Object({ name: Type.String(), values: Type.Array(Type.Number(), { minItems: 1 }) });
export const NoteChartSchema = Type.Object({ ...ChartBase, series: Type.Array(SeriesSchema, { minItems: 1 }) });
export type NoteChart = Static<typeof NoteChartSchema>;
const SingleSeriesSchema = Type.Object({ ...ChartBase, values: Type.Array(Type.Number(), { minItems: 1 }) });

/** 旧笔记一直使用 series；也接受单组 values 简写，编辑保存时保留每个系列。 */
export function parseNoteChart(text: string): NoteChart {
  const value: unknown = JSON.parse(text);
  const normalized = Value.Check(SingleSeriesSchema, value)
    ? { type: value.type, labels: value.labels, ...(value.title === undefined ? {} : { title: value.title }),
      series: [{ name: '', values: value.values }] } : value;
  if (!Value.Check(NoteChartSchema, normalized)
    || normalized.series.some((series) => series.values.length !== normalized.labels.length)) {
    throw new Error('图表需要 type（bar/line/pie）、labels、series（name 和等长的数值 values）。');
  }
  if (normalized.type === 'pie' && normalized.series.some((series) => series.values.some((value) => value < 0))) {
    throw new Error('饼图的 values 不能是负数。');
  }
  return normalized;
}

export const SAMPLE_NOTE_CHART: NoteChart = {
  type: 'bar', title: '示例图表', labels: ['第一步', '第二步', '第三步'],
  series: [{ name: '进展', values: [3, 5, 4] }],
};
