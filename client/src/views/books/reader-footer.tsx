// 阅读页底下一条（第 7 批设计稿 Reader-Paged）：全书百分比 + 进度条，不写章名。进度没存上时后面一句原因（只有出错写字）。

import type { ReactNode } from 'react';
import { percentText } from './book-format.ts';
import type { SyncState } from './progress-saver.ts';

export interface ReaderFooterProps {
  percent: number;
  sync: SyncState;
}

export function ReaderFooter(props: ReaderFooterProps): ReactNode {
  return (
    <footer className="bk-foot text-meta">
      <span className="bk-foot-percent">{percentText(props.percent)}</span>
      <div className="bk-progress" role="progressbar" aria-label="全书进度" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={Math.round(props.percent * 100)}>
        <i style={{ width: percentText(props.percent) }} />
      </div>
      {props.sync.status === 'failed' ? (
        <span className="bk-foot-sync is-error" role="status">
          进度没同步上，翻页时会再试{props.sync.error === '' ? '' : `（${props.sync.error}）`}
        </span>
      ) : null}
    </footer>
  );
}
