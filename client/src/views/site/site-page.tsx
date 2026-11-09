// Cyber Hunter 官网（11-09 设计稿，他看过说「按照这个做」）：页头 · 首屏（一句话 + 协作演示）· 功能（五个小演示）·
// 上手五步 · 下载 · 页脚。演示都写死，标「演示」；下载地址只来自发布清单（指向 GitHub Releases）。

import { useState, type ReactNode } from 'react';
import { CollabDemo } from './collab-demo.tsx';
import { FEATURES, FeatureDemo, type FeatureId } from './feature-demos.tsx';
import { HeroDownload, SiteDownloads } from './site-download.tsx';

const REPO = 'https://github.com/AaronMYL/plasticine';

function Brand(): ReactNode {
  return (
    <a className="ch-brand" href="#top">
      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
        <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <rect x="14" y="14" width="9" height="9" rx="2.5" fill="none" stroke="var(--ch-accent)" strokeWidth="1.6" />
        <path d="M10.2 10.2 L14.6 14.6" stroke="var(--ch-accent)" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <span>Cyber Hunter</span>
    </a>
  );
}

function Header(): ReactNode {
  return (
    <header className="ch-header">
      <div className="ch-wrap ch-header-row">
        <Brand />
        <nav className="ch-nav" aria-label="页面导航">
          <a className="ch-nav-link" href="#collab">协作</a>
          <a className="ch-nav-link" href="#features">功能</a>
          <a className="ch-nav-link" href="#start">上手</a>
          <a className="ch-nav-link" href="#download">下载</a>
          <a className="ch-nav-link" href={REPO}>GitHub</a>
        </nav>
        <a className="ch-btn ch-btn-primary ch-btn-small" href="#download">下载</a>
      </div>
    </header>
  );
}

function Hero(): ReactNode {
  return (
    <section id="top" className="ch-hero">
      <div className="ch-grid-bg" />
      <div className="ch-glow" />
      <div className="ch-wrap ch-hero-grid">
        <div className="ch-hero-copy">
          <h1 className="ch-h1">你的 AI，和朋友的 AI，一起把事做完</h1>
          <p className="ch-lead">Plasticine 装在你自己的电脑上。连上 Cyber Hunter，联系人和他们的 AI 都能接手你拆出来的事。</p>
          <div className="ch-row" style={{ marginTop: 8 }}>
            <HeroDownload />
            <a className="ch-btn ch-btn-ghost" href="#features">看看能做什么</a>
          </div>
          <div className="ch-facts ch-mono"><span>免费</span><span>开源 AGPL-3.0</span><span>数据在你自己的电脑上</span></div>
        </div>
        <CollabDemo />
      </div>
    </section>
  );
}

function Features(): ReactNode {
  const [id, setId] = useState<FeatureId>('notes');
  const feature = FEATURES.find((item) => item.id === id) ?? FEATURES[0];
  if (feature === undefined) return null;
  return (
    <section id="features" className="ch-section">
      <div className="ch-wrap ch-stack">
        <div className="ch-section-head">
          <span className="ch-eyebrow ch-mono">Plasticine</span>
          <h2 className="ch-h2">一个人用，也已经很顺手</h2>
        </div>
        <div className="ch-tabs" role="tablist" aria-label="功能">
          {FEATURES.map((item) => (
            <button key={item.id} type="button" role="tab" className="ch-tab" aria-selected={item.id === id}
              aria-controls="ch-feature-panel" onClick={() => setId(item.id)}>{item.label}</button>
          ))}
        </div>
        <div className="ch-feature" id="ch-feature-panel" role="tabpanel" aria-label={feature.label}>
          <div className="ch-feature-copy" key={`copy-${id}`}>
            <h3 className="ch-rise">{feature.title}</h3>
            <p className="ch-rise-2">{feature.line}</p>
            <span className="ch-pill ch-mono" style={{ alignSelf: 'flex-start', marginTop: 6 }}><i />演示 · 点右边试试</span>
          </div>
          <div className="ch-win">
            <div className="ch-winbar" aria-hidden="true">
              <b /><b /><b /><span className="ch-mono" style={{ marginLeft: 6 }}>{feature.window}</span>
            </div>
            <div className="ch-winbody" key={id}><FeatureDemo id={id} /></div>
          </div>
        </div>
      </div>
    </section>
  );
}

const TUTORIAL: ReadonlyArray<{ title: string; line: string; mini: ReactNode; column?: boolean }> = [
  { title: '下载安装', line: 'Windows、Mac 各一个安装包。', mini: (
    <span className="ch-btn ch-btn-primary ch-btn-small" aria-hidden="true">安装</span>) },
  { title: '建账号', line: '起一个 @账号，设个密码。', column: true, mini: <>
    <span className="ch-field ch-mono">@xiaolin</span>
    <span className="ch-field" style={{ letterSpacing: '0.2em', color: 'var(--ch-fg3)' }}>••••••••</span>
  </> },
  { title: '连模型', line: '选一个模型服务，登录你的订阅。', mini: <>
    <span className="ch-chip ch-chip-mute">ChatGPT</span><span className="ch-chip">Claude</span>
    <span className="ch-chip ch-chip-mute">更多</span>
  </> },
  { title: '加联系人', line: '输入对方的 @账号，对方同意就连上。', mini: <>
    <span className="ch-dot">你</span><span className="ch-mini-link" /><span className="ch-dot ch-dot-peer">杰</span>
  </> },
  { title: '发起协作', line: '说要做什么，需要谁就邀请谁。', mini: (
    <span className="ch-bubble ch-bubble-me" style={{ fontSize: 12, padding: '6px 10px', maxWidth: '100%' }}>
      帮我和阿杰排个行程</span>) },
];

function Start(): ReactNode {
  return (
    <section id="start" className="ch-section">
      <div className="ch-wrap ch-stack">
        <div className="ch-section-head">
          <span className="ch-eyebrow ch-mono">上手</span>
          <h2 className="ch-h2">五步，从装好到一起干活</h2>
        </div>
        <ol className="ch-tuts">
          {TUTORIAL.map((item, index) => (
            <li key={item.title} className="ch-tut">
              <div className={item.column === true ? 'ch-mini ch-mini-col' : 'ch-mini'} aria-hidden="true">
                {item.mini}
              </div>
              <div>
                <div className="ch-no ch-mono">{`0${index + 1}`}</div>
                <h3>{item.title}</h3>
                <p>{item.line}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Download(): ReactNode {
  return (
    <section id="download" className="ch-section">
      <div className="ch-wrap ch-stack">
        <div className="ch-section-head">
          <span className="ch-eyebrow ch-mono">下载</span>
          <h2 className="ch-h2">装到你自己的电脑上</h2>
        </div>
        <SiteDownloads />
      </div>
    </section>
  );
}

function Footer(): ReactNode {
  return (
    <footer className="ch-footer">
      <div className="ch-wrap ch-footer-row">
        <span>© 2026 Cyber Hunter</span>
        <div className="ch-footer-links">
          <a className="ch-nav-link" href={REPO}>GitHub</a>
          <a className="ch-nav-link" href={`${REPO}/blob/main/LICENSE`}>开源许可</a>
          <a className="ch-nav-link" href={`${REPO}/blob/main/TRADEMARKS.md`}>名字和图标</a>
        </div>
      </div>
    </footer>
  );
}

export function SitePage(): ReactNode {
  return (
    <div className="ch">
      <Header />
      <main>
        <Hero />
        <Features />
        <Start />
        <Download />
      </main>
      <Footer />
    </div>
  );
}
