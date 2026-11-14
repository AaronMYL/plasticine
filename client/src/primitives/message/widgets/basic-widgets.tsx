// 消息里的图片和表格：只看不答。图片整张显示、几张排格子，点开看大图；表格放不下就在自己的框里横向滚动，不撑破对话。

import type { ReactNode } from 'react';
import type { ImageWidget, TableWidget } from '../../../api/shared.ts';
import { CHAT_IMAGE_BOX, ImageGrid } from '../../image-grid/index.tsx';

export function ImageGallery({ images }: { images: ImageWidget[] }): ReactNode {
  if (images.length === 0) {
    return null;
  }
  // 11-14 图片统一：和对话里的图同一套排法（一张整张显示，多张排格子），点开是同一个看图层，说明写在看图层顶上；
  // 只有一张时说明也写在图下面。
  const only = images.length === 1 ? images[0] : undefined;
  return (
    <figure className="widget-gallery">
      <ImageGrid box={CHAT_IMAGE_BOX} images={images.map((image) => ({ src: image.src, alt: image.alt,
        caption: image.caption ?? image.alt,
        ratio: image.width !== undefined && image.height !== undefined && image.width > 0
          ? image.height / image.width : null }))} />
      {only?.caption === undefined ? null : <figcaption className="text-meta">{only.caption}</figcaption>}
    </figure>
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
