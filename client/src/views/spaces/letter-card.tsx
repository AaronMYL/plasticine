// 主线里的来信卡（第 8 批第 6 条，设计稿 Chat-Letter）：Plasticine 说一句，下面一张卡——缩略图、霞鹜文楷的题目、
// 「来信」、›；点了打开那封信。

import { useEffect, type ReactNode } from 'react';
import { Icon } from '../../shell/icons.tsx';
import { routeHash } from '../../shell/routes.ts';
import { loadWenkai } from './space-fonts.ts';
import { spaceRoute } from './space-links.ts';
import { SpaceThumb } from './space-thumb.tsx';

export function LetterCard({ letter }: { letter: { spaceId: string; title: string } }): ReactNode {
  // 题目用文楷：第一次出现来信卡时才载那份字体（浏览器只下用到的字所在的那几片）。
  useEffect(() => {
    void loadWenkai().catch((cause: unknown) => console.warn('文楷没载上，题目先用系统楷体', cause));
  }, []);
  return (
    <a className="letter-card" href={routeHash(spaceRoute(letter.spaceId))} aria-label={`来信：${letter.title}`}>
      <SpaceThumb spaceId={letter.spaceId} className="letter-card-thumb" />
      <span className="letter-card-text">
        <span className="letter-card-title">{letter.title}</span>
        <span className="text-meta">来信</span>
      </span>
      <Icon name="chevron-right" size={14} />
    </a>
  );
}
