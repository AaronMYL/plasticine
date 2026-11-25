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
