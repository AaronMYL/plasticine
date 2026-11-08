// 目录：每章一行（章名 + 大约几分钟），正在读的那一章是当前位置的样子（--tint2 底），点了跳到那一章开头。

import type { ReactNode } from 'react';
import type { BookTocEntry } from '../../api/shared.ts';
import { Sheet } from '../../primitives/sheet/index.tsx';
import { minutesToRead } from './book-format.ts';

export interface TocSheetProps {
  open: boolean;
  phone: boolean;
  title: string;
  toc: readonly BookTocEntry[];
  current: number;
  onPick: (chapter: number) => void;
  onClose: () => void;
}

export function TocSheet(props: TocSheetProps): ReactNode {
  return (
    <Sheet open={props.open} variant={props.phone ? 'drawer' : 'panel'} title={`${props.title} · 目录`}
      onClose={props.onClose}>
      <ol className="bk-toc">
        {props.toc.map((entry, index) => (
          <li key={`${index}:${entry.title}`}>
            <button type="button" className="bk-toc-row" aria-current={index === props.current ? 'true' : undefined}
              onClick={() => props.onPick(index)}>
              <span className="bk-toc-title">{entry.title.replace(/　/g, ' ')}</span>
              <span className="text-meta">
                {index === props.current ? '你在这 · ' : ''}约 {minutesToRead(entry.chars)} 分钟
              </span>
            </button>
          </li>
        ))}
      </ol>
    </Sheet>
  );
}
