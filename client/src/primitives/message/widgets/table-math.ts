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
    if (left.trim() === '' || right.trim() === '') {
      return Number(left.trim() === '') - Number(right.trim() === '');
    }
    const order = numeric ? (tableNumber(left) ?? 0) - (tableNumber(right) ?? 0) : COLLATOR.compare(left, right);
    return order * sign;
  });
}

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
