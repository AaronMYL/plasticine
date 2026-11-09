// 官网「下载」那块：读 /download/desktop.json 和 manifest.json（腾讯云只留这两份清单，安装包在 GitHub Releases，
// 11-09 他定）。按访客的系统把那张卡标出来；读不到给重试，不编地址。

import { useEffect, useState, type ReactNode } from 'react';
import type { ReleaseAsset } from '../../../../agent/shared/release-manifest.ts';
import { parseDesktopCatalog, parseLinuxCommand, type DesktopCatalog } from '../download/release-catalog.ts';

export const RELEASES_URL = 'https://github.com/AaronMYL/plasticine/releases';
const READ_TIMEOUT_MS = 15_000;

type Load<T> = { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; value: T };

function useRead<T>(url: string, parse: (text: string, url: string) => T): [Load<T>, () => void] {
  const [state, setState] = useState<Load<T>>({ kind: 'loading' });
  const [round, setRound] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
    setState({ kind: 'loading' });
    fetch(url, { cache: 'no-store', signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setState({ kind: 'ready', value: parse(await response.text(), url) });
    }).catch((cause: unknown) => {
      console.warn('发布清单没读到', cause);
      setState({ kind: 'failed' });
    }).finally(() => clearTimeout(timeout));
    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [url, parse, round]);
  return [state, () => setRound((value) => value + 1)];
}

type Platform = 'mac' | 'windows' | 'linux' | 'phone';

/** 访客的系统（和下载页 platformOf 同一套认法；这里不引下载页，免得把它的样式和组件带进官网）。 */
export function visitorPlatform(agent: string): Platform {
  if (/iPhone|iPad|Android/i.test(agent)) return 'phone';
  if (/Windows/i.test(agent)) return 'windows';
  if (/Linux|X11|CrOS/i.test(agent)) return 'linux';
  return 'mac';
}

function useVisitorPlatform(): Platform {
  return visitorPlatform(navigator.userAgent);
}

const MB = 1024 * 1024;
function size(asset: ReleaseAsset): string {
  return `${Math.round(asset.size / MB)} MB`;
}

/** 首屏的主按钮：认出系统给对应的包，读不到清单就跳到下载区。 */
export function HeroDownload(): ReactNode {
  const platform = useVisitorPlatform();
  const [desktop] = useRead(new URL('/download/desktop.json', window.location.origin).href, parseDesktopCatalog);
  const mac = platform === 'mac';
  const asset = desktop.kind === 'ready' ? desktop.value[mac ? 'mac' : 'windows'] : null;
  const label = platform === 'phone' || platform === 'linux' ? '下载' : `下载 ${mac ? 'Mac' : 'Windows'} 版`;
  return (
    <a className="ch-btn ch-btn-primary" href={asset === null || platform === 'phone' ? '#download' : asset.url}>
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v8m0 0L4.5 6.5M8 10l3.5-3.5M3 13h10"
        fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      <span>{label}</span>
    </a>
  );
}

function DesktopCard({ name, kind, asset, mine, load, onRetry }: { name: string; kind: string; asset: ReleaseAsset | null;
  mine: boolean; load: Load<DesktopCatalog>['kind']; onRetry: () => void }): ReactNode {
  return (
    <div className="ch-card" data-mine={mine}>
      <div className="ch-card-head"><strong>{name}</strong>
        <span className="ch-sub ch-mono">{asset === null ? kind : `${kind} · ${size(asset)}`}</span></div>
      {load === 'failed' ? <p className="ch-error" role="alert">没读到安装包。{' '}
        <button type="button" className="ch-act" onClick={onRetry}>重新读取</button></p>
        : asset === null ? <button type="button" className="ch-btn ch-btn-ghost" disabled>
          {load === 'loading' ? '正在读…' : `${name} 版还没有`}</button>
          : <a className={mine ? 'ch-btn ch-btn-primary' : 'ch-btn ch-btn-ghost'} href={asset.url}>下载 {name} 版</a>}
    </div>
  );
}

function ServerCard(): ReactNode {
  const [command, retry] = useRead(new URL('/download/manifest.json', window.location.origin).href, parseLinuxCommand);
  const [copied, setCopied] = useState<boolean | null>(null);
  const copy = (text: string): void => {
    navigator.clipboard.writeText(text).then(() => setCopied(true), (cause: unknown) => {
      console.warn('复制安装命令没成', cause);
      setCopied(false);
    });
  };
  return (
    <div className="ch-card">
      <div className="ch-card-head"><strong>服务器</strong><span className="ch-sub ch-mono">Linux</span></div>
      {command.kind === 'failed' ? <p className="ch-error" role="alert">没读到安装命令。{' '}
        <button type="button" className="ch-act" onClick={retry}>重新读取</button></p> : (
        <div className="ch-command">
          <code className="ch-mono">{command.kind === 'ready' ? command.value : '正在读…'}</code>
          <button type="button" className="ch-act" disabled={command.kind !== 'ready'}
            onClick={() => command.kind === 'ready' && copy(command.value)}>{copied === true ? '复制好了' : '复制'}</button>
        </div>
      )}
      {copied === false ? <p className="ch-error" role="alert">复制不了，选中上面的命令手动复制。</p> : null}
    </div>
  );
}

export function SiteDownloads(): ReactNode {
  const platform = useVisitorPlatform();
  const [desktop, retry] = useRead(new URL('/download/desktop.json', window.location.origin).href, parseDesktopCatalog);
  const value = desktop.kind === 'ready' ? desktop.value : null;
  return (
    <>
      <div className="ch-downloads">
        <DesktopCard name="Windows" kind=".exe" asset={value?.windows ?? null} mine={platform === 'windows'}
          load={desktop.kind} onRetry={retry} />
        <DesktopCard name="Mac" kind=".dmg" asset={value?.mac ?? null} mine={platform === 'mac'} load={desktop.kind}
          onRetry={retry} />
        <ServerCard />
      </div>
      <div className="ch-links ch-mono">
        {value === null ? null : <span>版本 {value.version}</span>}
        <a href={RELEASES_URL}>历史版本</a>
        <a href="https://github.com/AaronMYL/plasticine">源码</a>
      </div>
    </>
  );
}
