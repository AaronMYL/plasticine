// 主线的欢迎卡（11-08 First-Main；2026-11-12《首次使用解耦》改成引导）：建完账号后在主线最上面，一张张往下出——
//   账号一行（名字 · @账号）→ 主线 AI 说一句 →「连上一个模型」（没连上时是整张卡，可跳过；连上了收成一行，跳过了收成
//   一行带「连上」）→ 连上或跳过以后一句话 + 几个开始（按这台电脑装了什么应用排，welcome-starts.ts）。
// 写死的卡，不调模型，也不冒充模型说话。跳过记在这台设备上；没连模型时点开始，先把连模型那张亮出来，连上接着发那一句。

import { useEffect, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import type { AccountState, LineMessageView, OnboardingApp, WelcomeStart } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { hostProfile } from '../../shell/host.ts';
import { Icon, type IconName } from '../../shell/icons.tsx';
import { relativeTime } from '../../shell/relative-time.ts';
import { useStore } from '../../state/use-store.ts';
import { MainAvatar, useMainIdentity } from '../mates/main-identity.tsx';
import { ConnectCard, noModelConnected } from '../models/connect-card.tsx';
import { choiceName, providerName } from '../models/model-store.ts';
import { arrangeStarts } from './welcome-starts.ts';
import './welcome-message.css';

const START_ICONS: Readonly<Record<string, IconName>> = {
  notes: 'notes',
  note: 'notes',
  feed: 'feed',
  conversation: 'conversation',
  chat: 'conversation',
  books: 'books',
  mail: 'mail',
  globe: 'globe',
  tasks: 'tasks',
  sparkle: 'sparkle',
};

/** 这台设备上跳过了连模型（第一次的引导）。 */
export const MODEL_SKIP_KEY = 'plasticine.welcome.modelSkipped';

function readSkipped(): boolean {
  try {
    return window.localStorage.getItem(MODEL_SKIP_KEY) === '1';
  } catch (cause) {
    console.warn('读不到「跳过了连模型」，当没跳过', cause);
    return false;
  }
}

function writeSkipped(skipped: boolean): void {
  try {
    if (skipped) window.localStorage.setItem(MODEL_SKIP_KEY, '1');
    else window.localStorage.removeItem(MODEL_SKIP_KEY);
  } catch (cause) {
    console.warn('记不下「跳过了连模型」，这次照样跳过', cause);
  }
}

function StartButton({ start, disabled, onStart }: { start: WelcomeStart; disabled: boolean;
  onStart: (start: WelcomeStart) => void }): ReactNode {
  const icon = START_ICONS[start.icon];
  return (
    <button type="button" className="welcome-start" disabled={disabled} onClick={() => onStart(start)}>
      {icon === undefined ? null : <Icon name={icon} size={14} />}
      <span>{start.label}</span>
    </button>
  );
}

/** 收成一行的那一步：账号、模型。 */
function DoneRow({ label, children, action }: { label: string; children: ReactNode; action?: ReactNode }): ReactNode {
  return (
    <div className="welcome-row">
      <span className="welcome-row-label">{label}</span>
      <span className="welcome-row-value">{children}</span>
      {action ?? <span className="welcome-row-done" role="img" aria-label="好了"><Icon name="check" size={14} /></span>}
    </div>
  );
}

function useAccount(): AccountState | null {
  const api = useApi();
  const [account, setAccount] = useState<AccountState | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    api.account.state(controller.signal).then(setAccount, (cause: unknown) => {
      if (!controller.signal.aborted) console.warn('没读到账号，欢迎卡不画账号那一行', cause);
    });
    return () => controller.abort();
  }, [api]);
  return account;
}

function useHostApps(): OnboardingApp[] {
  const [apps, setApps] = useState<OnboardingApp[]>([]);
  useEffect(() => {
    let alive = true;
    void hostProfile().then((profile) => {
      if (alive && profile !== null) setApps(profile.apps);
    });
    return () => {
      alive = false;
    };
  }, []);
  return apps;
}

export function WelcomeMessage({ lineId, message }: { lineId: string; message: LineMessageView }): ReactNode {
  const live = useLive();
  const main = useMainIdentity();
  const account = useAccount();
  const apps = useHostApps();
  const models = useStore(live.models.store);
  const [skipped, setSkipped] = useState(readSkipped);
  const [pending, setPending] = useState<WelcomeStart | null>(null);
  const [sending, setSending] = useState(false);
  const providers = models.value?.providers;
  const connected = providers?.find((item) => item.connected !== null) ?? null;
  const missing = noModelConnected(providers);
  const showCard = missing && (!skipped || pending !== null);
  const resolved = models.loaded && !showCard;
  const starts = arrangeStarts(message.starts ?? [], apps);
  const name = account?.displayName ?? null;
  const send = (picked: WelcomeStart): void => {
    if (sending) return;
    setSending(true);
    void live.lines.send(lineId, picked.prompt).finally(() => setSending(false));
  };
  const start = (picked: WelcomeStart): void => {
    if (missing) {
      setPending(picked);
      return;
    }
    send(picked);
  };
  const skip = (): void => {
    writeSkipped(true);
    setSkipped(true);
    setPending(null);
  };
  const reopen = (): void => {
    writeSkipped(false);
    setSkipped(false);
  };
  const onConnected = (): void => {
    writeSkipped(false);
    setSkipped(false);
    const next = pending;
    setPending(null);
    if (next !== null) send(next);
  };
  const lead = `好了${name === null ? '' : `，${name}`}。再连一个模型，我就能替你做事。`;
  const after = missing ? '好，先不连。笔记、阅读、网页照常能用，用到模型时再连。想从哪儿开始？' : '连上了。想从哪儿开始？';
  const modelLabel = choiceName(models.value) ?? (connected === null ? null : providerName(connected));
  return (
    <article className="welcome-message" aria-label={`${main.name} 的欢迎`} data-message-seq={message.seq}>
      {account === null ? null : (
        <DoneRow label="账号">
          {account.displayName ?? ''}
          {account.handle === null ? null : <> · <span className="welcome-handle">@{account.handle}</span></>}
        </DoneRow>
      )}
      <header className="welcome-head">
        <MainAvatar main={main} size={20} />
        <span className="welcome-name">{main.name}</span>
        <time className="text-meta welcome-time" dateTime={message.createdAt}>
          {relativeTime(message.createdAt, new Date())}
        </time>
      </header>
      <p className="welcome-text">{lead}</p>
      {showCard ? (
        <section className="welcome-card" aria-label="连上一个模型">
          <div className="welcome-card-head">
            <h2 className="welcome-card-title">连上一个模型</h2>
            <span className="welcome-card-sub">用已有的订阅登录，或者填 key</span>
          </div>
          {pending === null ? null : <p className="welcome-pending">连上后接着做「{pending.label}」</p>}
          <ConnectCard onConnected={onConnected} />
          <div className="welcome-card-foot">
            <button type="button" className="text-button text-button-quiet" onClick={skip}>跳过</button>
          </div>
        </section>
      ) : null}
      {!showCard && connected !== null ? <DoneRow label="模型">{modelLabel}</DoneRow> : null}
      {!showCard && missing ? (
        <DoneRow label="模型" action={<button type="button" className="text-button" onClick={reopen}>连上</button>}>
          <span className="welcome-muted">先跳过了</span>
        </DoneRow>
      ) : null}
      {resolved ? <p className="welcome-text">{after}</p> : null}
      {resolved && starts.length > 0 ? (
        <div className="welcome-starts" role="group" aria-label="从哪儿开始">
          {starts.map((item) => <StartButton key={item.id} start={item} disabled={sending} onStart={start} />)}
        </div>
      ) : null}
    </article>
  );
}
