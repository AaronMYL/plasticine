import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useApi } from '../../api/context.tsx';
import type { MigrationImportView } from '../../api/shared.ts';
import { Spinner } from '../../primitives/busy/index.tsx';
import { showResultToast } from '../../primitives/toast/index.tsx';
import { deviceTimeZone } from '../../state/time-zone.ts';
import { resultText } from './migration-text.ts';
import './migration.css';

const POLL_MS = 2_000;
const ANNOUNCE_KEY = 'plasticine.migration.announce';
const CLOCK_SLACK_MS = 60_000;

export type RestartKind = 'merge' | 'replace' | 'undo';

const TITLES: Record<RestartKind, string> = {
  merge: '正在合并，Plasticine 马上重启',
  replace: '正在替换，Plasticine 马上重启',
  undo: '正在退回，Plasticine 马上重启',
};

export function announceMigrationResult(): void {
  let text: string | null = null;
  let failed = false;
  try {
    const raw = window.sessionStorage.getItem(ANNOUNCE_KEY);
    window.sessionStorage.removeItem(ANNOUNCE_KEY);
    if (raw !== null) {
      const value = JSON.parse(raw) as { text?: unknown; failed?: unknown };
      text = typeof value.text === 'string' ? value.text : null;
      failed = value.failed === true;
    }
  } catch {
    text = null;
  }
  if (text !== null) showResultToast(text, failed);
}

function remember(text: string, failed: boolean): void {
  try {
    window.sessionStorage.setItem(ANNOUNCE_KEY, JSON.stringify({ text, failed }));
  } catch (cause) {
    console.warn('重启后的那句提示存不下', cause);
  }
}

export function RestartCover({ kind, since, onFailed }: { kind: RestartKind; since: number;
  onFailed: (view: MigrationImportView) => void }): ReactNode {
  const api = useApi();
  const [checking, setChecking] = useState<number | null>(null);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = (): void => {
      api.migration.status().then((status) => {
        if (stopped) return;
        const result = status.result;
        if (result !== null && Date.parse(result.at) >= since - CLOCK_SLACK_MS) {
          remember(resultText(result, deviceTimeZone()), result.error !== null);
          window.location.reload();
          return;
        }
        const view = status.import;
        if (view?.state === 'failed') {
          onFailed(view);
          return;
        }
        setChecking(view?.state === 'applying' && view.bytes > 0 ? Math.min(99, Math.floor(view.stagedBytes / view.bytes
          * 100)) : null);
        timer = setTimeout(poll, POLL_MS);
      }, () => {
        if (!stopped) timer = setTimeout(poll, POLL_MS);
      });
    };
    timer = setTimeout(poll, POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [api, since, onFailed]);
  return createPortal(
    <div className="mig-cover" role="alertdialog" aria-modal="true" aria-label={TITLES[kind]}>
      <div className="mig-cover-body">
        <Spinner label={TITLES[kind]} />
        <b className="mig-cover-title">{checking === null ? TITLES[kind] : `正在核对文件 ${checking}%`}</b>
        <span className="mig-caption">大约一两分钟；好了这一页自己回来。</span>
      </div>
    </div>,
    document.body,
  );
}
