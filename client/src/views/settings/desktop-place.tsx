// 设置 · 系统 ·「Plasticine 跑在哪」（设计稿 Settings-System，第 14 条）：两张卡，这台 Mac / 这台电脑 和 远程。点另一张
// 不马上换：卡下面出「换到…」，点了壳才停或起本机本体、窗口载入新地址（界面会重新打开）。换过去不搬数据，这句常显。
// 远程没填过地址时，远程卡里出一个地址框。只在桌面客户端里出。

import { useState, type FormEvent, type ReactNode } from 'react';
import type { ServerMode, ServerStatus } from '../../api/shared.ts';
import { Icon } from '../../shell/icons.tsx';
import { computerName, parseServer, type DesktopShell } from './desktop-shell.ts';
import { SectionHead } from './section-head.tsx';
import './desktop.css';

function hostOf(url: string | null): string | null {
  if (url === null) {
    return null;
  }
  try {
    return new URL(url).host;
  } catch (error) {
    if (error instanceof TypeError) {
      return url;
    }
    throw error;
  }
}

/** 选中的那张卡下面那一行：连没连上、本机本体起没起来。 */
function liveLine(status: ServerStatus, mode: ServerMode): { text: string; tone: 'ok' | 'run' | 'err' } | null {
  if (status.choice.mode !== mode) {
    return null;
  }
  if (mode === 'remote') {
    return status.loaded === '' ? { text: '没连上', tone: 'err' } : { text: '已连上', tone: 'ok' };
  }
  switch (status.local) {
    case 'running':
      return { text: '在运行', tone: 'ok' };
    case 'starting':
      return { text: '正在启动', tone: 'run' };
    case 'failed':
      return { text: status.problem ?? '没起来', tone: 'err' };
    default:
      return null;
  }
}

interface CardProps {
  mode: ServerMode;
  title: string;
  detail: string | null;
  icon: 'mac' | 'cloud';
  selected: boolean;
  disabled: boolean;
  line: ReturnType<typeof liveLine>;
  onSelect: () => void;
  children?: ReactNode;
}

function PlaceCard({ mode, title, detail, icon, selected, disabled, line, onSelect, children }: CardProps): ReactNode {
  return (
    <label className="desktop-place-card" data-selected={selected ? 'true' : 'false'}>
      <input type="radio" name="desktop-place" value={mode} checked={selected} disabled={disabled}
        onChange={onSelect} />
      <span className="desktop-place-text">
        <span className="desktop-place-title">{title}</span>
        {detail === null ? null : <span className="desktop-place-detail">{detail}</span>}
        {line === null ? null : <span className="desktop-place-live" data-tone={line.tone}>
          <span className="desktop-place-dot" aria-hidden="true" />{line.text}</span>}
        {children}
      </span>
      <span className="desktop-place-icon" aria-hidden="true"><Icon name={icon} size={18} /></span>
    </label>
  );
}

export function DesktopPlace({ shell, status, onStatus }: { shell: DesktopShell; status: ServerStatus;
  onStatus: (status: ServerStatus) => void }): ReactNode {
  const [pending, setPending] = useState<ServerMode | null>(null);
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const local = computerName(shell);
  const shown = pending ?? status.choice.mode;
  const needsAddress = shown === 'remote' && status.choice.remoteUrl === null;
  const select = (mode: ServerMode): void => {
    setError(null);
    setPending(mode === status.choice.mode ? null : mode);
  };
  const confirm = (event?: FormEvent): void => {
    event?.preventDefault();
    if (pending === null) {
      return;
    }
    const remoteUrl = needsAddress ? address.trim() : status.choice.remoteUrl;
    if (pending === 'remote' && (remoteUrl === null || remoteUrl === '')) {
      setError('先填远程地址。');
      return;
    }
    setBusy(true);
    shell.server.choose({ mode: pending, remoteUrl }).then((value) => {
      onStatus(parseServer(value));
      setPending(null);
    }, (cause: unknown) => {
      // 壳的错误经 ipc 回来时带着「Error invoking remote method …」的前缀，只留后面那一句。
      const message = cause instanceof Error ? cause.message : '没换过去，稍后再试。';
      setError(message.replace(/^Error invoking remote method '[^']*': (Error: )?/, ''));
    }).finally(() => setBusy(false));
  };
  return (
    <section className="block" aria-labelledby="settings-desktop-place">
      <SectionHead id="settings-desktop-place" title="Plasticine 跑在哪" />
      <form className="desktop-place" role="radiogroup" aria-label="Plasticine 跑在哪" onSubmit={confirm}>
        <div className="desktop-place-cards">
          <PlaceCard mode="this_computer" title={local}
            detail={status.bundled ? (shell.platform === 'macos' ? '合上盖子就停' : '关机就停') : '这个安装包没带'}
            icon="mac" selected={shown === 'this_computer'} disabled={!status.bundled || busy}
            line={liveLine(status, 'this_computer')} onSelect={() => select('this_computer')} />
          <PlaceCard mode="remote" title="远程" detail={hostOf(status.choice.remoteUrl)} icon="cloud"
            selected={shown === 'remote'} disabled={busy} line={liveLine(status, 'remote')}
            onSelect={() => select('remote')}>
            {needsAddress ? <input className="field desktop-place-address" type="text" inputMode="url" autoComplete="url"
              aria-label="远程地址" placeholder="https://you.cyberhunter.top" value={address}
              onChange={(event) => setAddress(event.target.value)} /> : null}
          </PlaceCard>
        </div>
        <div className="desktop-place-foot">
          <p className="desktop-place-note">换过去不搬数据；两边的数据各是各的。</p>
          {pending === null ? null : <>
            <button type="button" className="secondary-button button-small" disabled={busy}
              onClick={() => select(status.choice.mode)}>取消</button>
            <button type="submit" className="primary-button button-small" disabled={busy}>
              {pending === 'remote' ? '换到远程' : `换到${local}`}</button>
          </>}
        </div>
        {error === null ? null : <p className="block-empty is-error" role="alert">{error}</p>}
      </form>
    </section>
  );
}
