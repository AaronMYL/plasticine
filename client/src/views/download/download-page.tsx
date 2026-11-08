// 独立下载入口：不加载主应用、登录状态或 Service Worker。所有包的版本和 URL 只来自公开 manifest。
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '../../shell/icons.tsx';
import { PlasticineMark } from '../../shell/plasticine-mark.tsx';
import { StatusGlyph } from '../../shell/glyph.tsx';
import { usePhone } from '../../shell/use-viewport-width.ts';
import { DOWNLOAD_ASSET_KEYS, existingInstanceUrl, linuxInstallCommand, parseDownloadCatalog,
  type DownloadCatalog } from './release-catalog.ts';
import './download-page.css';

type Platform = 'mac' | 'windows' | 'linux';
const PLATFORMS: Record<Platform, { name: string; icon: IconName; detail: string }> = {
  mac: { name: 'Mac', icon: 'mac', detail: 'Apple 芯片 · ZIP 安装包' },
  windows: { name: 'Windows', icon: 'device', detail: '64 位 · EXE 安装包' },
  linux: { name: 'Linux', icon: 'terminal', detail: 'x64 / ARM64 · 安装脚本' },
};
const PLATFORM_ORDER: Platform[] = ['mac', 'windows', 'linux'];
/** 读取清单是小请求；超时后保留连接入口，给明确的重试按钮。 */
const READ_TIMEOUT_MS = 15_000;

type LoadState = { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; catalog: DownloadCatalog };

function initialPlatform(): Platform {
  if (/Windows/i.test(navigator.userAgent)) return 'windows';
  if (/Linux/i.test(navigator.userAgent) && !/Android/i.test(navigator.userAgent)) return 'linux';
  return 'mac';
}

function PlatformTabs({ platform, onChange }: { platform: Platform; onChange: (platform: Platform) => void })
  : ReactNode {
  const tabs = useRef<HTMLDivElement>(null);
  return <div ref={tabs} className="download-tabs" role="tablist" aria-label="操作系统">
    {PLATFORM_ORDER.map((id, index) => <button key={id} type="button" role="tab" id={`download-tab-${id}`}
      aria-controls="download-platform" aria-selected={platform === id} tabIndex={platform === id ? 0 : -1}
      onClick={() => onChange(id)} onKeyDown={(event) => {
        let next: number;
        if (event.key === 'ArrowRight') next = (index + 1) % PLATFORM_ORDER.length;
        else if (event.key === 'ArrowLeft') next = (index + PLATFORM_ORDER.length - 1) % PLATFORM_ORDER.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = PLATFORM_ORDER.length - 1;
        else return;
        event.preventDefault();
        onChange(PLATFORM_ORDER[next] ?? 'mac');
        tabs.current?.querySelectorAll('button')[next]?.focus();
      }}><Icon name={PLATFORMS[id].icon} />{PLATFORMS[id].name}</button>)}
  </div>;
}

function CopyCommand({ command }: { command: string }): ReactNode {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setError(false);
    } catch {
      setError(true);
    }
  };
  return <>
    <pre className="download-command" aria-label="Linux 安装命令"><code>{command}</code></pre>
    <button type="button" className="primary-button" onClick={() => void copy()}>
      <Icon name={copied ? 'check' : 'copy'} />{copied ? '已复制安装命令' : '复制安装命令'}</button>
    {error ? <p className="download-error" role="alert">复制不了，请选中上方命令手动复制。</p> : null}
  </>;
}

function InstallHelp({ platform, catalog }: { platform: Platform; catalog: DownloadCatalog | null }): ReactNode {
  return <section className="download-help" aria-label="安装与打开">
    <h3>安装与打开</h3>
    {platform === 'mac' ? <ol><li>下载后解压，把 Plasticine 拖进「应用程序」。</li>
      <li>打开 Plasticine，跟随首次使用页面连接模型。</li></ol> : null}
    {platform === 'windows' ? <ol><li>运行 EXE 安装包，按安装向导完成安装。</li>
      <li>从开始菜单或系统托盘打开 Plasticine，再连接模型。</li></ol> : null}
    {platform === 'linux' ? <ol><li>在有 systemd 的 Linux 服务器运行上方安装命令。</li>
      <li>用 SSH 转发 <code>ssh -L 8790:127.0.0.1:8790 用户@服务器</code>，在浏览器打开
        <a href="http://127.0.0.1:8790/">本机 8790 端口</a>。</li>
      <li>输入安装结束时给出的配对码，再连接模型。</li></ol> : null}
    <p>手机：在电脑的「设置 → 系统 → 设备」添加设备，再用手机扫描配对二维码。</p>
    {platform !== 'linux' && catalog !== null ? <p className="download-help-detail">
      程序自带运行环境，安装后会建立自己的 Plasticine。已有一份可输入地址继续使用。
    </p> : null}
  </section>;
}

function Checksums({ catalog, manifestUrl }: { catalog: DownloadCatalog; manifestUrl: string }): ReactNode {
  return <section className="download-checksums" aria-label="校验文件">
    <h3>SHA-256</h3><p>下载后核对文件的 SHA-256，与下方对应值相同。</p>
    <ul>{DOWNLOAD_ASSET_KEYS.map((key) => <li key={key}>
      <a href={catalog.assets[key].url}>{catalog.assets[key].name}</a><code>{catalog.assets[key].sha256}</code>
    </li>)}</ul><a href={manifestUrl}>发布清单</a>
  </section>;
}

function ConnectExisting({ phone, navigate }: { phone: boolean; navigate: (url: string) => void }): ReactNode {
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  return <section className="download-connect" aria-labelledby="download-connect-title">
    <h2 id="download-connect-title">{phone ? '连接已有 Plasticine' : '已经有 Plasticine？'}</h2>
    <p>{phone ? '在已登录的电脑上添加设备，用手机扫描配对二维码。' : '打开已有的地址，继续同一份对话和资料。'}</p>
    <form onSubmit={(event) => {
      event.preventDefault();
      try { navigate(existingInstanceUrl(address)); setError(null); }
      catch (cause) { setError(cause instanceof Error ? cause.message : '地址打不开，请核对后重试。'); }
    }}><label htmlFor="instance-address">Plasticine 地址</label>
      <div className="download-address-row"><input id="instance-address" className="field-input" value={address}
        placeholder="https://…" autoComplete="url" inputMode="url" required
        onChange={(event) => setAddress(event.target.value)} />
      <button type="submit" className={phone ? 'primary-button' : 'secondary-button'}>
        打开<Icon name="forward" size={14} /></button></div>
      {error === null ? null : <p className="download-error" role="alert">{error}</p>}
    </form><div className="download-phone-hint"><Icon name={phone ? 'mac' : 'phone'} size={20} />
      <p>{phone ? '第一次使用？先在电脑上安装。' : '手机扫码后就能连接。'}</p></div>
  </section>;
}

export interface DownloadPageProps {
  fetcher?: typeof fetch;
  manifestUrl?: string;
  navigate?: (url: string) => void;
}

export function DownloadPage({ fetcher = fetch,
  manifestUrl = new URL('/download/manifest.json', window.location.origin).href,
  navigate = (url: string) => window.location.assign(url) }: DownloadPageProps): ReactNode {
  const phone = usePhone();
  const [platform, setPlatform] = useState<Platform>(initialPlatform);
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [round, setRound] = useState(0);
  const [help, setHelp] = useState(false);
  const [checksums, setChecksums] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => { controller.abort(); setState({ kind: 'failed' }); }, READ_TIMEOUT_MS);
    setState({ kind: 'loading' });
    fetcher(manifestUrl, { cache: 'no-store', signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const catalog = parseDownloadCatalog(await response.text(), manifestUrl);
      if (!controller.signal.aborted) setState({ kind: 'ready', catalog });
    }).catch(() => {
      if (!controller.signal.aborted) setState({ kind: 'failed' });
    }).finally(() => clearTimeout(timeout));
    return () => { controller.abort(); clearTimeout(timeout); };
  }, [fetcher, manifestUrl, round]);

  const item = PLATFORMS[platform];
  const catalog = state.kind === 'ready' ? state.catalog : null;
  const connect = <ConnectExisting phone={phone} navigate={navigate} />;
  return <div className="download-page">
    <header className="download-header"><div className="download-brand"><PlasticineMark size={28} />Plasticine</div>
      <nav aria-label="下载页导航"><button type="button" className="text-button text-button-quiet"
        onClick={() => setHelp((show) => !show)}>安装帮助</button>
      {phone ? null : <a href="#download-connect-title">连接已有 Plasticine<Icon name="forward" size={14} /></a>}
      </nav></header>
    <main className="download-main"><h1>{phone ? '在手机上使用' : '下载 Plasticine'}</h1>
      <div className="download-options">
        {phone ? connect : null}
        <section className="download-install" aria-labelledby="download-install-title">
          <h2 id="download-install-title">在电脑上开始</h2>
          <PlatformTabs platform={platform} onChange={setPlatform} />
          <div role="tabpanel" id="download-platform" aria-labelledby={`download-tab-${platform}`}>
            {state.kind === 'loading' ? <p className="download-loading" role="status">
              <StatusGlyph status="run" label="读取安装包" />正在读取安装包版本…</p> : null}
            {state.kind === 'failed' ? <div className="download-failed"><p className="download-error" role="alert">
              暂时无法读取安装包版本，请重新读取。</p><button type="button" className="primary-button"
              onClick={() => setRound((old) => old + 1)}>重新读取</button></div> : null}
            {catalog === null ? null : <>
              <div className="download-platform-info"><Icon name={item.icon} size={32} /><div>
                <h3>Plasticine for {item.name}</h3><span>{item.detail}</span></div></div>
              <div className="download-controls">{platform === 'linux'
                ? <CopyCommand key={catalog.manifest.version} command={linuxInstallCommand(catalog)} />
                : <a className="primary-button" href={catalog.assets[platform].url}>
                  <Icon name="download" />下载 {item.name} 版</a>}</div>
              <p className="download-version">版本 <span>{catalog.manifest.version}</span></p>
              <div className="download-links"><button type="button" className="text-button"
                aria-expanded={help} onClick={() => setHelp((show) => !show)}>安装说明</button>
              <button type="button" className="text-button" aria-expanded={checksums}
                onClick={() => setChecksums((show) => !show)}>校验文件</button></div>
            </>}
            {help ? <InstallHelp platform={platform} catalog={catalog} /> : null}
            {checksums && catalog !== null ? <Checksums catalog={catalog} manifestUrl={manifestUrl} /> : null}
          </div>
        </section>
        {phone ? null : connect}
      </div>
    </main><footer className="download-footer"><span>Plasticine</span><span>macOS · Windows · Linux</span></footer>
  </div>;
}
