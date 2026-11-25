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
  const tail = (): ReactNode => {
    if (status.state === 'ready') {
      return <span className="ai-use-static">{status.source === 'env' ? '服务器上配好的' : '已装好'}</span>;
    }
    if (status.state === 'installing') {
      return <span className="ai-use-static" role="status">正在装 · {percent}%</span>;
    }
    if (status.state === 'unsupported') {
      return <span className="ai-use-static" data-quiet="true">这种系统用不了</span>;
    }
    return <button type="button" className="secondary-button button-small"
      onClick={() => void live.transcriber.install()}>{failed === null ? '安装' : '重试'}</button>;
  };
  return (
    <div className="ai-use">
      <div className="ai-use-line">
        <span className="ai-use-name">本地转写<span className="ai-use-sub">视频转文字{
          status.state === 'absent' || status.state === 'failed' ? ` · ${aboutSize(status.totalBytes)}` : ''
        }</span></span>
        {tail()}
      </div>
      {failed ?? error ? <p className="ai-use-error" role="alert">{failed ?? error}</p> : null}
    </div>
  );
}
