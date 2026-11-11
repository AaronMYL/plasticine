// 下载页（11-08 设计稿 Download / Phone-Download）：独立入口，不加载主应用、登录状态或 Service Worker。
// 读 /download/desktop.json（agent/shared/desktop-release.ts）认出系统——Mac / Windows 的主按钮直接下桌面客户端
// （Mac 给 dmg）；次级链接：另一个系统、装在服务器上（点开显示 Linux 命令和复制，命令来自 manifest.json 的安装脚本）、
// 已经有 Plasticine？去登录（填 @账号或地址跳过去）。手机上：先在电脑上装好，再用手机扫码打开；「已经有了，去登录」。
// 旧 Swift Mac App / Windows 托盘版不再作为主下载。包的地址和版本只来自发布清单，读不到不编。

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Icon } from '../../shell/icons.tsx';
import { PlasticineMark } from '../../shell/plasticine-mark.tsx';
import { loginTarget } from '../onboard/handle.ts';
import { parseDesktopCatalog, parseLinuxCommand, shortVersion, type DesktopCatalog } from './release-catalog.ts';
import './download-page.css';

export type DownloadPlatform = 'mac' | 'windows' | 'linux' | 'phone';
/** 读清单是小请求；超时就当没读到，给重试。 */
const READ_TIMEOUT_MS = 15_000;

type Load<T> = { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; value: T };

export function platformOf(agent: string): DownloadPlatform {
  if (/iPhone|iPad|Android/i.test(agent)) return 'phone';
  if (/Windows/i.test(agent)) return 'windows';
  if (/Linux|X11|CrOS/i.test(agent)) return 'linux';
  return 'mac';
}

function useManifest<T>(fetcher: typeof fetch, url: string, parse: (text: string, url: string) => T, enabled: boolean)
  : [Load<T>, () => void] {
  const [state, setState] = useState<Load<T>>({ kind: 'loading' });
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
    setState({ kind: 'loading' });
    fetcher(url, { cache: 'no-store', signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const value = parse(await response.text(), url);
      setState({ kind: 'ready', value });
    }).catch((cause: unknown) => {
      console.warn('发布清单没读到', cause);
      setState({ kind: 'failed' });
    }).finally(() => clearTimeout(timeout));
    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [fetcher, url, parse, enabled, round]);
  return [state, () => setRound((value) => value + 1)];
}

function ServerInstall({ fetcher, manifestUrl }: { fetcher: typeof fetch; manifestUrl: string }): ReactNode {
  const [command, retry] = useManifest(fetcher, manifestUrl, parseLinuxCommand, true);
  const [copied, setCopied] = useState<boolean | null>(null);
  if (command.kind === 'loading') {
    return <p className="download-note" role="status">正在读安装命令…</p>;
  }
  if (command.kind === 'failed') {
    return <p className="download-error" role="alert">没读到安装命令。
      <button type="button" className="text-button" onClick={retry}>再读一次</button></p>;
  }
  const copy = (): void => {
    navigator.clipboard.writeText(command.value).then(() => setCopied(true), (cause: unknown) => {
      console.warn('复制安装命令没成', cause);
      setCopied(false);
    });
  };
  return (
    <section className="download-panel" aria-label="装在服务器上">
      <pre className="download-command"><code>{command.value}</code></pre>
      <div className="download-panel-row">
        <span className="download-note">在有 systemd 的 Linux 服务器上运行，装完会给一条建账号的链接。</span>
        <button type="button" className="secondary-button button-small" onClick={copy}>
          <Icon name={copied === true ? 'check' : 'copy'} size={14} />{copied === true ? '复制好了' : '复制'}</button>
      </div>
      {copied === false ? <p className="download-error" role="alert">复制不了，选中上面的命令手动复制。</p> : null}
    </section>
  );
}

function GoSignIn({ navigate }: { navigate: (url: string) => void }): ReactNode {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const target = loginTarget(value, null, null);
    if (target.kind === 'elsewhere') navigate(target.url);
    else setError(value.trim() === '' ? '先填 @账号或地址。' : '认不出这个 @账号或地址。');
  };
  return (
    <form className="download-panel download-signin" onSubmit={submit} aria-label="去登录">
      <label className="download-label" htmlFor="download-who">@账号或地址</label>
      <div className="download-signin-row">
        <input id="download-who" className="field-input" value={value} autoFocus autoCapitalize="none"
          spellCheck={false} inputMode="email" placeholder="@账号"
          onChange={(event) => { setValue(event.target.value); setError(null); }} />
        <button type="submit" className="primary-button">去登录</button>
      </div>
      {error === null ? null : <p className="download-error" role="alert">{error}</p>}
    </form>
  );
}

type Panel = 'server' | 'signin' | null;

function DesktopButton({ platform, desktop, onRetry }: { platform: 'mac' | 'windows'; desktop: Load<DesktopCatalog>;
  onRetry: () => void }): ReactNode {
  const name = platform === 'mac' ? 'Mac' : 'Windows';
  if (desktop.kind === 'failed') {
    return <p className="download-error" role="alert">没读到安装包。
      <button type="button" className="text-button" onClick={onRetry}>再读一次</button></p>;
  }
  const asset = desktop.kind === 'ready' ? desktop.value[platform] : null;
  const detail = platform === 'mac' ? 'Apple 芯片和 Intel 都能用' : '64 位';
  return (
    <>
      {asset === null ? <button type="button" className="primary-button download-main" disabled>
        <Icon name="download" size={16} />{desktop.kind === 'loading' ? '正在读…' : `${name} 版还没有`}</button> : (
        <a className="primary-button download-main" href={asset.url}><Icon name="download" size={16} />下载 {name} 版</a>
      )}
      {desktop.kind === 'ready' && asset !== null
        ? <p className="download-note text-meta">{detail} · {shortVersion(desktop.value.version)}</p> : null}
    </>
  );
}

function OtherSystem({ platform, desktop }: { platform: 'mac' | 'windows'; desktop: Load<DesktopCatalog> }): ReactNode {
  const asset = desktop.kind === 'ready' ? desktop.value[platform] : null;
  if (asset === null) return null;
  return <a className="download-link" href={asset.url}>
    <Icon name={platform === 'mac' ? 'mac' : 'device'} size={14} />{platform === 'mac' ? 'Mac' : 'Windows'}</a>;
}

export interface DownloadPageProps {
  fetcher?: typeof fetch;
  base?: string;
  navigate?: (url: string) => void;
  agent?: string;
}

export function DownloadPage({ fetcher = fetch, base = window.location.origin,
  navigate = (url: string) => window.location.assign(url), agent = navigator.userAgent }: DownloadPageProps)
  : ReactNode {
  const platform = platformOf(agent);
  const phone = platform === 'phone';
  const [desktop, retry] = useManifest(fetcher, new URL('/download/desktop.json', base).href, parseDesktopCatalog,
    !phone);
  const [panel, setPanel] = useState<Panel>(platform === 'linux' ? 'server' : null);
  const [shared, setShared] = useState(false);
  const toggle = (next: Panel): void => setPanel((current) => (current === next ? null : next));
  const manifestUrl = new URL('/download/manifest.json', base).href;
  const share = (): void => {
    const url = window.location.href;
    const done = (): void => setShared(true);
    if (navigator.share !== undefined) {
      navigator.share({ title: 'Plasticine', url }).then(done, (cause: unknown) => console.warn('没分享出去', cause));
    } else {
      navigator.clipboard.writeText(url).then(done, (cause: unknown) => console.warn('复制下载链接没成', cause));
    }
  };
  return (
    <main className="download-page" data-platform={platform}>
      <div className="download-hero">
        <PlasticineMark size={phone ? 52 : 56} />
        <h1>Plasticine</h1>
        <p className="download-sub">记得你、能替你动手的私人 AI</p>
        {phone ? <>
          <p className="download-phone-text">先在电脑上装好，<br />再用手机扫码打开。</p>
          <button type="button" className="primary-button download-main" aria-expanded={panel === 'signin'}
            onClick={() => toggle('signin')}>已经有了，去登录</button>
          {panel === 'signin' ? <GoSignIn navigate={navigate} /> : null}
          <button type="button" className="download-link download-link-strong" onClick={share}>
            <Icon name={shared ? 'check' : 'link'} size={14} />{shared ? '下载链接好了' : '把下载链接发到电脑'}</button>
        </> : <>
          {platform === 'linux' ? null : <DesktopButton platform={platform} desktop={desktop} onRetry={retry} />}
          <nav className="download-alt" aria-label="别的装法">
            {platform === 'mac' ? <OtherSystem platform="windows" desktop={desktop} /> : null}
            {platform === 'windows' || platform === 'linux' ? <OtherSystem platform="mac" desktop={desktop} /> : null}
            {platform === 'linux' ? <OtherSystem platform="windows" desktop={desktop} /> : null}
            <button type="button" className="download-link" aria-expanded={panel === 'server'}
              onClick={() => toggle('server')}><Icon name="cloud" size={14} />装在服务器上（Linux）</button>
            <button type="button" className="download-link" aria-expanded={panel === 'signin'}
              onClick={() => toggle('signin')}><Icon name="globe" size={14} />已经有 Plasticine？去登录</button>
          </nav>
          {panel === 'server' ? <ServerInstall fetcher={fetcher} manifestUrl={manifestUrl} /> : null}
          {panel === 'signin' ? <GoSignIn navigate={navigate} /> : null}
        </>}
      </div>
    </main>
  );
}
