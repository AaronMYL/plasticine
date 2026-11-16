// CSV / TSV 读写（11-16 表格转 CSV、CSV 转 Excel 用）：按 RFC 4180 处理引号、逗号和换行；写出来的 CSV 开头带 BOM，
// Windows 上的 Excel 直接双击打开中文不乱码。

import type { Cell } from './package-xml.ts';

const BOM = '﻿';

/** 读一份 CSV（或 TSV）成行；开头的 BOM 去掉，末尾的空行不算。 */
export function parseCsv(text: string, delimiter: ',' | '\t'): string[][] {
  const source = text.startsWith(BOM) ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? '';
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"' && cell === '') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') {
        index += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function csvCell(value: Cell, delimiter: string): string {
  const text = value === null ? '' : String(value);
  return text.includes('"') || text.includes(delimiter) || /[\r\n]/.test(text) || /^\s|\s$/.test(text)
    ? `"${text.replace(/"/g, '""')}"` : text;
}

/** 行写成 CSV（或 TSV）：换行用 CRLF，CSV 开头带 BOM。 */
export function writeCsv(rows: readonly (readonly Cell[])[], delimiter: ',' | '\t'): string {
  const body = rows.map((row) => row.map((value) => csvCell(value, delimiter)).join(delimiter)).join('\r\n');
  return `${delimiter === ',' ? BOM : ''}${body}\r\n`;
}

/** 从 CSV 读来的格子：像数字的当数字（以 0 开头的编号、电话不算），别的照文字。 */
export function cellValue(text: string): Cell {
  const trimmed = text.trim();
  if (/^-?(0|[1-9]\d{0,14})(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  return text;
}
