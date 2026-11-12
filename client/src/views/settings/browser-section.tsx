// 设置 · 浏览器（2026-11-04 第 3 批，设计稿 Settings-Browser，他定：在 Plasticine 的浏览器里登录一次就记住；登录状态
// 只在他的设备上，不进服务器；2026-11-05 第 6 条：全部不用钥匙串，只记登录状态、不存密码）。两节：
// - 登录着的网站：这台 Mac 上 Plasticine 浏览器里有登录的网站（名字、域名、登录或导入的日子），行尾 ⋯ 退出这个网站。
//   段头右边「只在这台电脑」常显，为什么挂在锁图标按钮的浮框上（11-04：浮框只挂图标按钮）。
// - 导入：从 Chrome 或 Safari 搬一次登录（login-import-sheet.tsx）。
// 不是 Mac App（iPhone、网页版、旧 App）：登录不在这台设备上，整页一句话。

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Value } from 'typebox/value';
import { SiteLoginsSchema, type SiteLogin } from '../../api/shared.ts';
import { hostLogins } from '../../shell/host.ts';
import { timeInput } from '../../primitives/message/states.ts';
import { Icon } from '../../shell/icons.tsx';
import { RevealMore } from '../../shell/reveal-more.tsx';
import { deviceTimeZone } from '../../state/time-zone.ts';
import { useStore } from '../../state/use-store.ts';
import { LoginImportSheet } from './login-import-sheet.tsx';
import { loginImportRequested } from './login-import-request.ts';
import { SectionHead } from './section-head.tsx';

const LOCAL_TIP = '登录只存在这台电脑上，不进服务器';

/** 月-日，按这台设备的时区（登录记在这台 Mac 上）。 */
function day(iso: string | null): string {
  return timeInput(iso, deviceTimeZone()).slice(5, 10);
}

function SiteRow({ site, onForget }: { site: SiteLogin; onForget: () => void }): ReactNode {
  return (
    <li className="login-site">
      <span className="login-site-tile" aria-hidden="true">{Array.from(site.name)[0]?.toUpperCase()}</span>
      <span className="login-site-name">{site.name}</span>
      <span className="login-site-host text-meta">{site.host}</span>
      <time className="login-site-day text-meta" dateTime={site.since ?? undefined}>{day(site.since)}</time>
      <RevealMore label={`「${site.name}」的更多操作`}
        actions={[{ icon: 'close', label: '退出这个网站', onSelect: onForget }]} />
    </li>
  );
}

export function BrowserSection(): ReactNode {
  const [logins] = useState(hostLogins);
  const [sites, setSites] = useState<SiteLogin[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const requested = useStore(loginImportRequested);
  const [importing, setImporting] = useState(false);
  const load = useCallback((): void => {
    if (logins === null) {
      return;
    }
    logins.sites().then((raw) => {
      if (!Value.Check(SiteLoginsSchema, raw)) {
        throw new Error('客户端回的登录清单格式不对');
      }
      setSites(raw.sites);
      setProblem(null);
    }).catch((cause: unknown) => {
      console.warn('没读到登录着的网站', cause);
      setProblem('没读到这台电脑上的登录，稍后再试。');
    });
  }, [logins]);
  useEffect(load, [load]);
  useEffect(() => {
    if (requested && logins !== null) {
      loginImportRequested.set(false);
      setImporting(true);
    }
  }, [requested, logins]);
  if (logins === null) {
    return <p className="block-empty">登录只记在电脑上 Plasticine 的浏览器里，不进服务器；在电脑的客户端里打开这里看和导入。</p>;
  }
  const forget = (host: string): void => {
    logins.forget(host).then(load).catch((cause: unknown) => {
      console.warn('没能退出这个网站', cause);
      setProblem('没能退出这个网站，稍后再试。');
    });
  };
  const empty = sites !== null && sites.length === 0 && problem === null;
  return (
    <>
      {empty ? null : <section className="block" aria-labelledby="settings-logins">
        <SectionHead id="settings-logins" title="登录着的网站">
          <span className="login-local text-meta">
            <button type="button" className="icon-button login-local-icon" aria-label={LOCAL_TIP} data-tip={LOCAL_TIP}>
              <Icon name="lock" size={13} />
            </button>
            只在这台电脑
          </span>
        </SectionHead>
        {problem === null ? null : <p className="settings-message" role="alert">{problem}</p>}
        {sites === null || sites.length === 0 ? null : (
          <ul className="login-sites" aria-label="登录着的网站">
            {sites.map((site) => <SiteRow key={site.host} site={site} onForget={() => forget(site.host)} />)}
          </ul>
        )}
      </section>}
      <section className="block" aria-labelledby="settings-login-import">
        <SectionHead id="settings-login-import" title="导入" />
        <div className="login-import-row">
          <span className="login-site-tile login-import-tile" aria-hidden="true">
            <Icon name="download" size={15} />
          </span>
          <span className="login-site-name">从 Chrome 或 Safari 搬一次登录</span>
          <button type="button" className="chip-button" onClick={() => setImporting(true)}>导入…</button>
        </div>
      </section>
      <LoginImportSheet logins={logins} open={importing} onClose={() => setImporting(false)} onImported={load} />
    </>
  );
}
