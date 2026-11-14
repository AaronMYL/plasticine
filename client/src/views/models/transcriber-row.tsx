// 设置 · AI「本地转写」一行（第13批）：对话里交来的视频也要转写，不只抖音收藏，所以这里也能装。没装写多大、给「安装」；
// 装着写到哪了；装好写「已装好」，服务器上自己配的写「服务器上配好的」；这种系统没有现成组件就说用不了。

import { useEffect, type ReactNode } from 'react';
import { useLive } from '../../live.tsx';
import { useStore } from '../../state/use-store.ts';
import { aboutSize } from '../feed/transcriber-card.tsx';

export function TranscriberRow(): ReactNode {
  const live = useLive();
  const { status, error } = useStore(live.transcriber.state);
  useEffect(() => live.transcriber.open(), [live.transcriber]);
  if (status === null) return null;
  const failed = status.state === 'failed' ? status.error : null;
  const percent = status.totalBytes === 0 ? 0 : Math.floor(status.doneBytes / status.totalBytes * 100);
  return (
    <div className="ai-use">
      <div className="ai-use-line">
        <span className="ai-use-name">本地转写<span className="ai-use-sub">视频转文字{
          status.state === 'absent' || status.state === 'failed' ? ` · ${aboutSize(status.totalBytes)}` : ''
        }</span></span>
        {status.state === 'ready'
          ? <span className="ai-use-static">{status.source === 'env' ? '服务器上配好的' : '已装好'}</span>
          : status.state === 'installing' ? <span className="ai-use-static" role="status">正在装 · {percent}%</span>
            : status.state === 'unsupported' ? <span className="ai-use-static" data-quiet="true">这种系统用不了</span>
              : <button type="button" className="secondary-button button-small"
                onClick={() => void live.transcriber.install()}>{failed === null ? '安装' : '重试'}</button>}
      </div>
      {failed ?? error ? <p className="ai-use-error" role="alert">{failed ?? error}</p> : null}
    </div>
  );
}
