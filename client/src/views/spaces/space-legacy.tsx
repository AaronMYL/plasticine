// 还没重写成网页的旧版式空间（第 8 批第 6 条以前写的结构化文档）：重写完成以前照旧这样显示——一小行期号日期、结论大
// 标题、数字卡、正文（小节、图表、图片、引用）、右侧目录。只读：要改让 Plasticine 改（重写成网页以后才能在页面上改字）。
// 线上的旧空间全部重写成网页、确认没人用以后，这个文件和 space-blocks / space-chart / space-toc 一起删掉。

import { useRef, type ReactNode } from 'react';
import type { SpaceView } from '../../api/shared.ts';
import { SpaceBlocks, SpaceStats } from './space-blocks.tsx';
import { SpaceToc } from './space-toc.tsx';

export function LegacySpace({ space, phone, heading }: { space: SpaceView; phone: boolean; heading?: ReactNode }):
  ReactNode {
  const scroller = useRef<HTMLDivElement>(null);
  return (
    <div className="space-scroll" ref={scroller}>
      <article className="space-article" aria-label={space.title}>
        {space.doc.kicker === undefined ? null : <p className="text-meta space-kicker">{space.doc.kicker}</p>}
        {heading ?? <h1 className="space-headline">{space.doc.headline ?? space.title}</h1>}
        <SpaceStats stats={space.doc.stats} />
        <SpaceBlocks doc={space.doc} />
      </article>
      {phone ? null : <SpaceToc doc={space.doc} scroller={scroller} />}
    </div>
  );
}
