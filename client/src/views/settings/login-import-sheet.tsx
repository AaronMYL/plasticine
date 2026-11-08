// 导入登录（2026-11-04 第 3 批，设计稿 Import）：从 Chrome 或 Safari 搬一次登录状态到 Plasticine 的浏览器。
// 2026-11-05 第 6 条（他定：全部不用钥匙串）：只导登录状态，不导密码（协议里的 passwords 一律发 false）。
// 全在这台 Mac 上做（mac-logins.ts）：读 Chrome 时系统弹框问他允不允许读「Chrome Safe Storage」；
// Safari 的 Cookie 要「完全磁盘访问」，没给就如实说、给一个打开系统设置的按钮。导完一句说搬了多少。

import { useEffect, useState, type ReactNode } from 'react';
import { Value } from 'typebox/value';
import {
  LoginImportResultSchema,
  LoginSourcesSchema,
  type LoginImportResult,
  type LoginSource,
  type LoginSourceId,
  type PlasticineMacLogins,
} from '../../api/shared.ts';
import { Sheet } from '../../primitives/sheet/index.tsx';
import { usePhone } from '../../shell/use-viewport-width.ts';

const NAMES: Readonly<Record<LoginSourceId, string>> = { chrome: 'Chrome', safari: 'Safari' };

function detailOf(source: LoginSource): string {
  if (!source.available) {
    return `这台 Mac 上没有 ${NAMES[source.id]} 的数据`;
  }
  if (source.needs === 'full_disk_access') {
    return '要你在系统设置里给一次「完全磁盘访问」';
  }
  const parts = [source.profile, source.sites === null ? null : `${source.sites} 个网站`]
    .filter((part) => part !== null);
  return parts.join(' · ');
}

/** 导完的那一句。 */
export function importSummary(result: LoginImportResult): string {
  const skipped = result.skipped > 0 ? `；${result.skipped} 条过期或解不开的没搬` : '';
  return `搬过来 ${result.sites} 个网站的登录${skipped}`;
}

type Phase = { kind: 'idle' } | { kind: 'busy' } | { kind: 'done'; text: string } | { kind: 'problem'; text: string };

export function LoginImportSheet({ logins, open, onClose, onImported }: {
  logins: PlasticineMacLogins;
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}): ReactNode {
  const phone = usePhone();
  const [sources, setSources] = useState<LoginSource[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [from, setFrom] = useState<LoginSourceId>('chrome');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  useEffect(() => {
    if (!open) {
      return;
    }
    setPhase({ kind: 'idle' });
    let live = true;
    logins.sources().then((raw) => {
      if (!live) {
        return;
      }
      if (!Value.Check(LoginSourcesSchema, raw)) {
        throw new Error('Mac 回的导入来源格式不对');
      }
      setSources(raw.sources);
      setFrom(raw.sources.find((source) => source.available)?.id ?? 'chrome');
    }).catch((cause: unknown) => {
      console.warn('没读到能从哪儿导入', cause);
      if (live) {
        setFailed('没读到这台 Mac 上的浏览器，稍后再试。');
      }
    });
    return () => {
      live = false;
    };
  }, [logins, open]);
  const chosen = sources?.find((source) => source.id === from) ?? null;
  const start = (): void => {
    setPhase({ kind: 'busy' });
    // passwords 只为旧 App 对得上协议，永远是 false。
    logins.import({ from, passwords: false }).then((raw) => {
      if (!Value.Check(LoginImportResultSchema, raw)) {
        throw new Error('Mac 回的导入结果格式不对');
      }
      setPhase(raw.problem === null ? { kind: 'done', text: importSummary(raw) }
        : { kind: 'problem', text: raw.problem });
      onImported();
    }).catch((cause: unknown) => {
      console.warn('导入登录没成', cause);
      setPhase({ kind: 'problem', text: '导入没成：Mac 那边出了错，稍后再试。' });
    });
  };
  return (
    <Sheet open={open} variant={phone ? 'drawer' : 'panel'} title="导入登录" onClose={onClose} className="sheet-fit"
      state={sources === null ? (failed === null ? 'loading' : 'failed') : 'ready'} error={failed ?? undefined}>
      <div className="login-import">
        <div role="radiogroup" aria-label="从哪儿导入" className="login-import-sources">
          {(sources ?? []).map((source) => (
            <label key={source.id} className="login-import-source" data-chosen={source.id === from}>
              <input type="radio" name="login-import-from" checked={source.id === from} disabled={!source.available}
                onChange={() => setFrom(source.id)} />
              <span className="login-import-source-text">
                <span className="login-import-source-name">{NAMES[source.id]}</span>
                <span className="text-meta">{detailOf(source)}</span>
              </span>
            </label>
          ))}
        </div>
        {phase.kind === 'done' ? <p className="login-import-note" role="status">{phase.text}</p> : null}
        {phase.kind === 'problem' ? (
          <p className="login-import-note is-error" role="alert">
            {phase.text}
            {chosen?.needs === 'full_disk_access' ? (
              <button type="button" className="text-button" onClick={() => logins.openFullDiskAccess()}>
                打开系统设置
              </button>
            ) : null}
          </p>
        ) : null}
        <div className="login-import-actions">
          <button type="button" className="text-button" onClick={onClose}>{phase.kind === 'done' ? '好的' : '先不'}</button>
          {phase.kind === 'done' ? null : (
            <button type="button" className="primary-button"
              disabled={phase.kind === 'busy' || chosen?.available !== true} onClick={start}>
              {phase.kind === 'busy' ? '正在导入…' : '导入'}
            </button>
          )}
        </div>
      </div>
    </Sheet>
  );
}
