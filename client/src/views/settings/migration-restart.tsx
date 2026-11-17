// 选好合并、替换或退回以后（11-16 设计稿④⑤）：整页盖住「正在合并，Plasticine 马上重启」，隔两秒问一次服务；
// 服务重启回来、报了这一次的结果，就整页重新载入（各处的东西都换了），载入后由壳说一句做成了什么。
// 还在解开文件的，盖着的那页写核对到多少。全部替换以后登录换成那台的，问的时候会被带去登录页。

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useApi } from '../../api/context.tsx';
import type { MigrationImportView } from '../../api/shared.ts';
import { Spinner } from '../../primitives/busy/index.tsx';
import { showResultToast } from '../../primitives/toast/index.tsx';
import { deviceTimeZone } from '../../state/time-zone.ts';
import { resultText } from './migration-text.ts';
import './migration.css';

/** 隔多久问一次。 */
const POLL_MS = 2_000;
/** 重新载入后要说的那句存在这里（只这一个标签页）。 */
const ANNOUNCE_KEY = 'plasticine.migration.announce';
/** 结果的时间可能比点按钮早一点点（两边钟不齐）：放宽这么多。 */
const CLOCK_SLACK_MS = 60_000;

export type RestartKind = 'merge' | 'replace' | 'undo';

const TITLES: Record<RestartKind, string> = {
  merge: '正在合并，Plasticine 马上重启',
  replace: '正在替换，Plasticine 马上重启',
  undo: '正在退回，Plasticine 马上重启',
};

/** 壳载入时调：上一页留了话就说出来。 */
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
    // 存不下就不说那一句，数据照样换好了。
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
        // 服务正在重启：问不到是正常的，接着等。
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
