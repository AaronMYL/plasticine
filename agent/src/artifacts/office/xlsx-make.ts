import { type Cell, contentTypes, packageRels, relsXml, XML_HEAD, xmlEscape } from './package-xml.ts';
import { writeZip } from './zip-write.ts';

export interface SheetInput {
  name: string;
  rows: Cell[][];
}

const SHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const MAIN_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml';
const SHEET_NAME_MAX = 31;
const COLUMN_WIDTH_MIN = 8;
const COLUMN_WIDTH_MAX = 60;

function columnName(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

function cellXml(value: Cell, ref: string, bold: boolean, formulas: boolean): string {
  const style = bold ? ' s="1"' : '';
  if (value === null || value === '') {
    return '';
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? `<c r="${ref}"${style}><v>${value}</v></c>` : '';
  }
  if (typeof value === 'boolean') {
    return `<c r="${ref}" t="b"${style}><v>${value ? 1 : 0}</v></c>`;
  }
  if (formulas && value.startsWith('=') && value.length > 1) {
    return `<c r="${ref}"${style}><f>${xmlEscape(value.slice(1))}</f></c>`;
  }
  return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
}

export function sheetNames(sheets: readonly SheetInput[]): string[] {
  const used = new Set<string>();
  return sheets.map((sheet, index) => {
    const clean = Array.from(sheet.name.replace(/[\\/?*[\]:]/g, ' ').trim()).slice(0, SHEET_NAME_MAX).join('');
    let name = clean === '' ? `表${index + 1}` : clean;
    for (let n = 2; used.has(name.toLowerCase()); n += 1) {
      name = `${Array.from(clean).slice(0, SHEET_NAME_MAX - 3).join('')} ${n}`;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

function textWidth(value: Cell): number {
  return Array.from(String(value ?? '')).reduce((sum, char) => sum + ((char.codePointAt(0) ?? 0) > 255 ? 2 : 1), 0);
}

function sheetXml(sheet: SheetInput, formulas: boolean): string {
  const widths = new Map<number, number>();
  for (const row of sheet.rows) {
    row.forEach((value, column) => {
      const width = Math.min(COLUMN_WIDTH_MAX, Math.max(widths.get(column) ?? COLUMN_WIDTH_MIN, textWidth(value) + 2));
      widths.set(column, width);
    });
  }
  const cols = [...widths].sort((a, b) => a[0] - b[0])
    .map(([column, width]) => `<col min="${column + 1}" max="${column + 1}" width="${width}" customWidth="1"/>`);
  const rows = sheet.rows.map((row, r) =>
    `<row r="${r + 1}">${row.map((value, c) => cellXml(value, `${columnName(c)}${r + 1}`, r === 0, formulas))
      .join('')}</row>`);
  const pane = '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>';
  return `${XML_HEAD}<worksheet xmlns="${SHEET_NS}"><sheetViews><sheetView workbookViewId="0">`
    + `${sheet.rows.length > 1 ? pane : ''}</sheetView></sheetViews>`
    + `${cols.length === 0 ? '' : `<cols>${cols.join('')}</cols>`}<sheetData>${rows.join('')}</sheetData></worksheet>`;
}

const STYLES = `${XML_HEAD}<styleSheet xmlns="${SHEET_NS}">`
  + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>'
  + '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
  + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
  + '</fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>'
  + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

export function makeXlsx(input: readonly SheetInput[], formulas = true): Buffer {
  const sheets = input.length === 0 ? [{ name: '表1', rows: [] }] : input;
  const names = sheetNames(sheets);
  const workbook = `${XML_HEAD}<workbook xmlns="${SHEET_NS}" `
    + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
    + names.map((name, index) => `<sheet name="${xmlEscape(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
      .join('')
    + '</sheets></workbook>';
  const rels = sheets.map((_, index) => ({ id: `rId${index + 1}`, type: 'worksheet',
    target: `worksheets/sheet${index + 1}.xml` }));
  rels.push({ id: `rId${sheets.length + 1}`, type: 'styles', target: 'styles.xml' });
  return writeZip([
    { name: '[Content_Types].xml', data: contentTypes([
      ['/xl/workbook.xml', `${MAIN_TYPE}.sheet.main+xml`],
      ['/xl/styles.xml', `${MAIN_TYPE}.styles+xml`],
      ...sheets.map((_, index) => [`/xl/worksheets/sheet${index + 1}.xml`, `${MAIN_TYPE}.worksheet+xml`] as const),
    ]) },
    { name: '_rels/.rels', data: packageRels('xl/workbook.xml') },
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/_rels/workbook.xml.rels', data: relsXml(rels) },
    { name: 'xl/styles.xml', data: STYLES },
    ...sheets.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, data: sheetXml(sheet, formulas) })),
  ]);
}
