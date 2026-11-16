// Cyber Hunter 官网（11-15 他看过会动的预览说「就按照这版做」）：页头 · 首屏 · 舞台（真界面自动演示）· 手机直连 ·
// 端到端加密的范围 · 下载 · 常见问题 · 页脚。整页底下是应用里那套动态背景。下载地址只来自发布清单。

import { useRef, type ReactNode } from 'react';
import { HeroDownload, SiteDownloads } from './site-download.tsx';
import { Cipher, PhoneLink, Sea, Stage } from './site-stage.tsx';

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
          <a className="ch-nav-link" href="#stage">演示</a>
          <a className="ch-nav-link" href="#phone">手机</a>
          <a className="ch-nav-link" href="#encryption">加密</a>
          <a className="ch-nav-link" href="#download">下载</a>
          <a className="ch-nav-link" href="#faq">常见问题</a>
          <a className="ch-nav-link" href={REPO}>GitHub</a>
        </nav>
        <a className="ch-btn ch-btn-primary ch-btn-small" href="#download">下载</a>
      </div>
    </header>
  );
}

function Hero(): ReactNode {
  return (
    <section id="top" className="ch-wrap site-hero">
      <h1 className="site-h1">个人 AI 工作台，也能和联系人的 AI 协作</h1>
      <p className="site-lead">Plasticine 运行在你自己的电脑或服务器上。主线带着一组队友替你读、写、动手；
        也能和联系人的 Plasticine 互相交任务，消息端到端加密。</p>
      <div className="site-actions">
        <HeroDownload />
        <a className="ch-btn ch-btn-ghost" href="#stage">看演示</a>
      </div>
      <div className="ch-facts ch-mono"><span>免费</span><span>开源（AGPL-3.0）</span><span>数据只存在你自己的设备上</span></div>
    </section>
  );
}

function Phone(): ReactNode {
  return (
    <section id="phone" className="ch-wrap site-section">
      <span className="site-label">手机</span>
      <h2 className="site-h2">手机网页直连你的电脑</h2>
      <p className="site-lead">不用装应用：手机浏览器打开你自己的地址，登录后用的就是电脑上那一个 Plasticine。</p>
      <PhoneLink />
    </section>
  );
}

function Encryption(): ReactNode {
  return (
    <section id="encryption" className="ch-wrap site-section">
      <span className="site-label">加密</span>
      <h2 className="site-h2">端到端加密保护什么</h2>
      <Cipher text="封面按这个尺寸来。" />
      <ul className="site-scope">
        <li><strong>加密的</strong>和联系人、群组的消息，任务卡和附件；手机到你电脑的连接。</li>
        <li><strong>中继看得到的</strong>谁发给谁、什么时候、是消息还是任务，以及任务到了哪一步。</li>
        <li><strong>不在范围里的</strong>你发给模型提供商的内容；存在你电脑上的数据，由你的电脑保管。</li>
      </ul>
    </section>
  );
}

const FAQ: readonly { ask: string; answer: string }[] = [
  { ask: '数据存在哪里？', answer: '存在运行 Plasticine 的那台电脑或服务器上。Cyber Hunter 的中继只转发加密后的消息，读不到内容。' },
  { ask: '要自己准备模型吗？', answer: '要。在设置里连上你自己的模型账号，对话内容会发给你选的模型提供商，费用也付给他们。' },
  { ask: '队友是什么？', answer: '你给主线配的专职 AI，各有自己的设定，记忆是共用的。主线把事交给队友，队友之间也能交接、领任务卡。' },
  { ask: '手机上怎么用？', answer: '用手机浏览器打开你自己的地址并登录，不用装应用。电脑要开着并且联网。' },
  { ask: '收费吗？', answer: 'Plasticine 免费、开源（AGPL-3.0）。' },
];

function Faq(): ReactNode {
  return (
    <section id="faq" className="ch-wrap site-section">
      <span className="site-label">常见问题</span>
      <h2 className="site-h2">常见问题</h2>
      <div className="site-faq">
        {FAQ.map((item) => (
          <details key={item.ask} className="site-faq-item">
            <summary>{item.ask}</summary>
            <p>{item.answer}</p>
          </details>
        ))}
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
          <h2 className="ch-h2">下载</h2>
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
  const page = useRef<HTMLDivElement>(null);
  return (
    <div className="ch" ref={page}>
      <Sea page={page} />
      <Header />
      <main>
        <Hero />
        <section className="ch-wrap"><Stage /></section>
        <Phone />
        <Encryption />
        <Download />
        <Faq />
      </main>
      <Footer />
    </div>
  );
}
