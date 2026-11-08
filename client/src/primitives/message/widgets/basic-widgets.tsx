// 消息里的图片和表格：只看不答。图片几张排成一格一格，点开看原图；表格放不下就在自己的框里横向滚动，不撑破对话。

import type { ReactNode } from 'react';
import type { ImageWidget, TableWidget } from '../../../api/shared.ts';

export function ImageGallery({ images }: { images: ImageWidget[] }): ReactNode {
  if (images.length === 0) {
    return null;
  }
  return (
    <div className="widget-gallery" data-count={Math.min(images.length, 3)}>
      {images.map((image) => (
        <figure key={image.id} className="widget-image">
          <a href={image.src} target="_blank" rel="noreferrer" aria-label={`看原图：${image.alt}`}>
            <img src={image.src} alt={image.alt} loading="lazy"
              {...(image.width === undefined ? {} : { width: image.width })}
              {...(image.height === undefined ? {} : { height: image.height })} />
          </a>
          {image.caption === undefined ? null : <figcaption className="text-meta">{image.caption}</figcaption>}
        </figure>
      ))}
    </div>
  );
}

export function TableWidgetView({ widget }: { widget: TableWidget }): ReactNode {
  return (
    <figure className="widget widget-table">
      {widget.caption === undefined ? null : <figcaption className="widget-title">{widget.caption}</figcaption>}
      <div className="widget-table-scroll">
        <table>
          <thead>
            <tr>
              {widget.columns.map((column) => (
                <th key={column.key} scope="col" data-align={column.align ?? 'start'}>{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {widget.rows.map((row, index) => (
              // 表格行没有自己的 id：内容就是身份，行的顺序由消息定，不会重排。
              <tr key={`${index}:${Object.values(row).join('|')}`}>
                {widget.columns.map((column) => (
                  <td key={column.key} data-align={column.align ?? 'start'}>{row[column.key] ?? ''}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
