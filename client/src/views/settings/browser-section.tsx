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
import { SettingRow } from './setting-row.tsx';

const LOCAL_TIP = '登录只存在这台电脑上，不进服务器';

function day(iso: string | null): string {
  return timeInput(iso, deviceTimeZone()).slice(5, 10);
}

function SiteRow({ site, onForget }: { site: SiteLogin; onForget: () => void }): ReactNode {
  const since = day(site.since);
  return (
    <SettingRow as="li" className="login-site" name={site.name}
      sub={since === '' ? site.host : `${site.host} · ${since}`}
      lead={<span className="login-site-tile" aria-hidden="true">{Array.from(site.name)[0]?.toUpperCase()}</span>}>
      <RevealMore label={`「${site.name}」的更多操作`}
        actions={[{ icon: 'close', label: '退出这个网站', onSelect: onForget }]} />
    </SettingRow>
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
              <Icon name="lock" size={14} />
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
        <SettingRow name="从 Chrome 或 Safari 搬一次登录">
          <button type="button" className="secondary-button" onClick={() => setImporting(true)}>导入…</button>
        </SettingRow>
      </section>
      <LoginImportSheet logins={logins} open={importing} onClose={() => setImporting(false)} onImported={load} />
    </>
  );
}
