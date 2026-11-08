// 阅读页底下一条：章名、全书进度条、百分比、同步状态（「已同步」/「正在同步」/ 没存上时写原因）。
// 开着「在原文里标出」时前面加一句「Plasticine 标了 n 处」。手机上只留进度条和百分比。

import type { ReactNode } from 'react';
import { percentText } from './book-format.ts';
import type { SyncState } from './progress-saver.ts';

export interface ReaderFooterProps {
  chapterTitle: string;
  percent: number;
  sync: SyncState;
  markedCount: number | null;
  phone: boolean;
}

function syncText(sync: SyncState): string {
  if (sync.status === 'saved') {
    return '已同步';
  }
  return sync.status === 'pending' ? '正在同步' : '进度没同步上，翻页时会再试';
}

export function ReaderFooter(props: ReaderFooterProps): ReactNode {
  const marked = props.markedCount === null || props.markedCount === 0 ? '' : `Plasticine 标了 ${props.markedCount} 处 · `;
  return (
    <footer className="bk-foot text-meta">
      {props.phone ? null : <span className="bk-foot-chapter">{props.chapterTitle.replace(/　/g, ' ')}</span>}
      <div className="bk-progress" role="progressbar" aria-label="全书进度" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={Math.round(props.percent * 100)}>
        <i style={{ width: percentText(props.percent) }} />
      </div>
      <span className="bk-foot-percent">{percentText(props.percent)}</span>
      {props.phone ? null : (
        <span className={props.sync.status === 'failed' ? 'bk-foot-sync is-error' : 'bk-foot-sync'}>
          {marked}{syncText(props.sync)}
          {props.sync.status === 'failed' && props.sync.error !== '' ? `（${props.sync.error}）` : null}
        </span>
      )}
    </footer>
  );
}
