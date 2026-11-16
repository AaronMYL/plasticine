// 消息里表格的排序和合计（11-16）：数字列按数比，别的按中文排序比；合计只加靠右对齐、每格都是数的列，小数位取
// 各格最多的，有一格写了千分位逗号就也写。数怎么读和服务端导出用同一个 tableNumber。

import { tableNumber, type TableWidget } from '../../../api/shared.ts';

export type TableRow = TableWidget['rows'][number];
export interface TableSort {
  key: string;
  direction: 'asc' | 'desc';
}

const COLLATOR = new Intl.Collator('zh-CN', { numeric: true });

function cellOf(row: TableRow, key: string): string {
  return row[key] ?? '';
}

/** 这一列每个不空的格子都是数（至少有一格）。 */
export function numericColumn(rows: readonly TableRow[], key: string): boolean {
  const cells = rows.map((row) => cellOf(row, key).trim()).filter((cell) => cell !== '');
  return cells.length > 0 && cells.every((cell) => tableNumber(cell) !== null);
}

export function sortedRows(rows: readonly TableRow[], sort: TableSort | null): TableRow[] {
  if (sort === null) {
    return [...rows];
  }
  const numeric = numericColumn(rows, sort.key);
  const sign = sort.direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = cellOf(a, sort.key);
    const right = cellOf(b, sort.key);
    // 空格子总在最后，不管正排倒排。
    if (left.trim() === '' || right.trim() === '') {
      return Number(left.trim() === '') - Number(right.trim() === '');
    }
    const order = numeric ? (tableNumber(left) ?? 0) - (tableNumber(right) ?? 0) : COLLATOR.compare(left, right);
    return order * sign;
  });
}

/** 点表头：没排 → 正排 → 倒排 → 不排。 */
export function nextSort(current: TableSort | null, key: string): TableSort | null {
  if (current?.key !== key) {
    return { key, direction: 'asc' };
  }
  return current.direction === 'asc' ? { key, direction: 'desc' } : null;
}

function decimalsOf(text: string): number {
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : text.length - dot - 1;
}

function sumText(cells: readonly string[]): string {
  const clean = cells.map((cell) => cell.trim()).filter((cell) => cell !== '');
  const decimals = Math.max(0, ...clean.map((cell) => decimalsOf(cell.replaceAll(',', ''))));
  const sum = clean.reduce((total, cell) => total + (tableNumber(cell) ?? 0), 0);
  const fixed = sum.toFixed(decimals);
  if (!clean.some((cell) => cell.includes(','))) {
    return fixed;
  }
  const [whole = '', fraction] = fixed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

/** 合计行：第一列写「合计」，靠右对齐的数字列写和，别的空着。没有能加的列是 null。 */
export function totalRow(widget: TableWidget): TableRow | null {
  if (widget.total !== true || widget.rows.length < 2) {
    return null;
  }
  const row: TableRow = {};
  let summed = false;
  widget.columns.forEach((column, index) => {
    if (index > 0 && column.align === 'end' && numericColumn(widget.rows, column.key)) {
      row[column.key] = sumText(widget.rows.map((cells) => cellOf(cells, column.key)));
      summed = true;
    }
  });
  const first = widget.columns[0];
  if (!summed || first === undefined) {
    return null;
  }
  row[first.key] = '合计';
  return row;
}
