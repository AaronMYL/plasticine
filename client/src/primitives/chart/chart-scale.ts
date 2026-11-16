// 图表的纵轴刻度：三条横线，步长取 1 / 1.5 / 2 / 2.5 / 5 的十倍数，最低一条不高于最小值。点可以略高过最上一条
// （设计稿 Library-Space：40 / 55 / 70，最高点 71）。

const NICE = [1, 1.5, 2, 2.5, 5, 10];
const TICKS = 3;

function niceStep(raw: number): number {
  if (raw <= 0) {
    return 1;
  }
  const power = 10 ** Math.floor(Math.log10(raw));
  const found = NICE.find((factor) => factor * power >= raw - 1e-9) ?? 10;
  return found * power;
}

export interface ChartScale {
  ticks: number[];
  min: number;
  max: number;
}

export function chartScale(values: readonly number[], fromZero: boolean): ChartScale {
  const low = Math.min(...values, ...(fromZero ? [0] : []));
  const high = Math.max(...values);
  const step = niceStep((high - low) / (TICKS - 1));
  // 最低一条落在半个数量级的整数上（41 → 40，不是 30），点可以略高过最上一条。
  const unit = 10 ** Math.floor(Math.log10(step)) / 2;
  const first = Math.floor(low / unit) * unit;
  const ticks = Array.from({ length: TICKS }, (_unused, index) => Number((first + index * step).toFixed(6)));
  const top = ticks.at(-1) ?? high;
  return { ticks, min: first, max: Math.max(top, high) === first ? first + 1 : Math.max(top, high) };
}
