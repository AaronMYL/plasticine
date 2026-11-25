import type { ReactNode } from 'react';
import type { TranscriberStatus } from '../../api/shared.ts';
import './transcriber-card.css';

export function megabytes(bytes: number): string {
  return String(Math.round(bytes / 1_000_000));
}

export function aboutSize(bytes: number): string {
  return `约 ${String(Math.max(10, Math.round(bytes / 10_000_000) * 10))} MB`;
}

export function TranscriberCard({ status, error, onInstall, onLater }: { status: TranscriberStatus;
  error: string | null; onInstall: () => void; onLater?: () => void }): ReactNode {
  if (status.state === 'unsupported') {
    return <section className="kit-card" aria-label="本地转写">
      <h2>这台机器用不了本地转写</h2>
      <p>这种系统没有现成的转写组件，要在服务器上自己配好再解析视频。</p>
    </section>;
  }
  if (status.state === 'installing') {
    const percent = status.totalBytes === 0 ? 0 : Math.floor(status.doneBytes / status.totalBytes * 100);
    return <section className="kit-card" aria-label="本地转写">
      <h2>正在装本地转写</h2>
      <div className="kit-progress-line">
        <span>{status.step === 'unpack' ? '正在解开' : '正在下载'} · {megabytes(status.doneBytes)} / {
          megabytes(status.totalBytes)} MB</span>
        <span className="kit-percent">{percent}%</span>
      </div>
      <div className="kit-bar" role="progressbar" aria-label="装本地转写的进度" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={percent}><i style={{ transform: `scaleX(${String(percent / 100)})` }} /></div>
    </section>;
  }
  const failed = status.state === 'failed' ? status.error : null;
  return <section className="kit-card" aria-label="本地转写">
    <h2>解析视频要先装本地转写</h2>
    <p>{aboutSize(status.totalBytes)}，只装一次，装在 Plasticine 所在的机器上。装好接着解析这一条，视频不传给别人。</p>
    {failed ?? error ? <p className="kit-error" role="alert">{failed ?? error}</p> : null}
    <div className="kit-actions">
      <button type="button" className="primary-button" onClick={onInstall}>{failed === null ? '安装' : '重试'}</button>
      {onLater === undefined ? null
        : <button type="button" className="secondary-button" onClick={onLater}>先不</button>}
    </div>
  </section>;
}
