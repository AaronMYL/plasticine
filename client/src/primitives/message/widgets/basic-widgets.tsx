import type { ReactNode } from 'react';
import type { ImageWidget } from '../../../api/shared.ts';
import { CHAT_IMAGE_BOX, ImageGrid } from '../../image-grid/index.tsx';

export function ImageGallery({ images }: { images: ImageWidget[] }): ReactNode {
  if (images.length === 0) {
    return null;
  }
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
