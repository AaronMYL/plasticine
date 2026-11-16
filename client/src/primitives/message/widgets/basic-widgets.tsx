// 消息里的图片：只看不答。整张显示、几张排格子，点开看大图（表格在 table-widget.tsx，图表在 chart-widget.tsx）。

import type { ReactNode } from 'react';
import type { ImageWidget } from '../../../api/shared.ts';
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
