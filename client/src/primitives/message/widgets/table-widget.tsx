// 消息里的表格（11-16 设计稿「对话里的表格」）：点表头排序（正排、倒排、不排），排着的那列表头深一点、带箭头；
// 要合计的表最后一行写「合计」；数字列靠右、等宽数字。「下载表格」把屏上这个顺序存成 .xlsx 放进文件页「表格」文件夹，
// 再下载。放不下就在自己的框里横向滚动，第一列钉住，不撑破对话。

import { useState, type ReactNode } from 'react';
import { useApi } from '../../../api/context.tsx';
import { errorText } from '../../../api/errors.ts';
import { createRequestId } from '../../../api/request-id.ts';
import type { TableWidget } from '../../../api/shared.ts';
import { Icon } from '../../../shell/icons.tsx';
import { showToast } from '../../toast/index.tsx';
import { nextSort, sortedRows, totalRow, type TableRow, type TableSort } from './table-math.ts';

function ariaSort(sort: TableSort | null, key: string): 'ascending' | 'descending' | 'none' {
  if (sort?.key !== key) {
    return 'none';
  }
  return sort.direction === 'asc' ? 'ascending' : 'descending';
}

/** 浏览器自己下载（同源链接、cookie 会话）。 */
function startDownload(url: string, name: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
}

function DownloadButton({ widget, rows, total }: { widget: TableWidget; rows: TableRow[]; total: TableRow | null }):
  ReactNode {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const download = async (): Promise<void> => {
    setBusy(true);
    const cells = (row: TableRow): string[] => widget.columns.map((column) => row[column.key] ?? '');
    try {
      const entry = await api.files.exportTable({
        requestId: createRequestId(),
        title: widget.caption ?? '表格',
        header: widget.columns.map((column) => column.label),
        rows: rows.map(cells),
        ...(total === null ? {} : { total: cells(total) }),
      });
      startDownload(api.files.downloadUrl(entry.path), entry.name);
      showToast({ text: `已存进文件页「表格」：${entry.name}` });
    } catch (cause) {
      showToast({ text: `没下载成：${errorText(cause)}`, tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className="secondary-button button-small widget-table-download" disabled={busy}
      onClick={() => void download()}>
      <Icon name="download" size={14} />{busy ? '正在保存…' : '下载表格'}
    </button>
  );
}

export function TableWidgetView({ widget }: { widget: TableWidget }): ReactNode {
  const [sort, setSort] = useState<TableSort | null>(null);
  const rows = sortedRows(widget.rows, sort);
  const total = totalRow(widget);
  return (
    <figure className="widget widget-table">
      <div className="widget-table-head">
        {widget.caption === undefined ? <span /> : <figcaption className="widget-title">{widget.caption}</figcaption>}
        {widget.rows.length === 0 ? null : <DownloadButton widget={widget} rows={rows} total={total} />}
      </div>
      <div className="widget-table-scroll">
        <table>
          <thead>
            <tr>
              {widget.columns.map((column) => (
                <th key={column.key} scope="col" data-align={column.align ?? 'start'}
                  aria-sort={ariaSort(sort, column.key)} data-on={sort?.key === column.key ? '' : undefined}>
                  <button type="button" className="widget-table-sort"
                    onClick={() => setSort(nextSort(sort, column.key))}>
                    {column.label}
                    {sort?.key === column.key
                      ? <Icon name={sort.direction === 'asc' ? 'chevron-up' : 'chevron-down'} size={12} /> : null}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              // 表格行没有自己的 id：内容就是身份（排序只换顺序，不改内容）。
              <tr key={`${index}:${Object.values(row).join('|')}`}>
                {widget.columns.map((column) => (
                  <td key={column.key} data-align={column.align ?? 'start'}>{row[column.key] ?? ''}</td>
                ))}
              </tr>
            ))}
            {total === null ? null : (
              <tr className="widget-table-total">
                {widget.columns.map((column) => (
                  <td key={column.key} data-align={column.align ?? 'start'}>{total[column.key] ?? ''}</td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
