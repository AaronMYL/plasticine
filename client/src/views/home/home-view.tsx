import { useEffect, type ReactNode } from 'react';
import { useLive, useTimeZone } from '../../live.tsx';
import { accountInitial, DEFAULT_ACCOUNT_NAME } from '../../shell/account-name.ts';
import { IconButton } from '../../shell/icon-button.tsx';
import { PHONE_BELOW } from '../../shell/layout.ts';
import { useOpenPanel } from '../../shell/panel.ts';
import { useViewportWidth } from '../../shell/use-viewport-width.ts';
import { useStore } from '../../state/use-store.ts';
import { greetingOf } from './greeting.ts';
import { ContinueBlock, FeedHeadlines, TodayBlock } from './home-blocks.tsx';
import { doingLines, HomeDoing, HomeWaiting } from './home-now.tsx';
import { HomeNew } from './home-results.tsx';
import { HomeStart } from './home-start.tsx';
import './home.css';
import './home-work.css';

function useSummary(): string {
  const live = useLive();
  const asks = useStore(live.asks.store);
  const list = useStore(live.lines.list);
  const doing = doingLines(list.lines).length;
  return [asks.open.length > 0 ? `${asks.open.length} 件等你` : '', doing > 0 ? `${doing} 件在做` : '']
    .filter((part) => part !== '').join('，');
}

function Greeting({ now, phone }: { now: Date; phone: boolean }): ReactNode {
  const live = useLive();
  const openPanel = useOpenPanel();
  const timeZone = useTimeZone();
  useEffect(() => live.network.status.open(), [live.network.status]);
  const account = useStore(live.network.status.data).value?.account ?? null;
  const name = account?.displayName ?? null;
  const avatar = account?.avatar ?? null;
  const { date, hello } = greetingOf(now, name, timeZone);
  const summary = useSummary();
  const title = <h1><span className="home-date">{summary === '' ? date : `${date} · ${summary}`}</span>
    <span>{hello}</span></h1>;
  if (!phone) {
    return <header className="home-greeting">{title}</header>;
  }
  return (
    <header className="home-greeting" data-phone="true">
      {title}
      <div className="home-greeting-tools">
        <IconButton icon="search" label="查找内容" size={20} onClick={() => openPanel({ kind: 'search' })} />
        <button type="button" className="avatar home-avatar" aria-label={`设置 · ${name ?? DEFAULT_ACCOUNT_NAME}`}
          onClick={() => openPanel({ kind: 'settings' })}>
          {avatar === null ? accountInitial(name ?? DEFAULT_ACCOUNT_NAME)
            : <img className="avatar-image" src={avatar} alt="" aria-hidden="true" />}
        </button>
      </div>
    </header>
  );
}

export function HomeView({ now = new Date() }: { now?: Date }): ReactNode {
  const phone = useViewportWidth() < PHONE_BELOW;
  if (phone) {
    return (
      <div className="page home" data-device="phone">
        <Greeting now={now} phone />
        <HomeWaiting phone />
        <HomeDoing phone />
        <TodayBlock now={now} phone />
        <HomeNew now={now} />
        <HomeStart phone />
      </div>
    );
  }
  return (
    <div className="page home" data-device="desktop">
      <Greeting now={now} phone={false} />
      <div className="home-cols">
        <div className="home-main">
          <HomeWaiting phone={false} />
          <HomeDoing phone={false} />
          <HomeNew now={now} />
          <HomeStart phone={false} />
        </div>
        <div className="home-side">
          <TodayBlock now={now} phone={false} />
          <ContinueBlock now={now} />
          <FeedHeadlines now={now} phone={false} />
        </div>
      </div>
    </div>
  );
}
