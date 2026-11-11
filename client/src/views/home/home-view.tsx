// 首页（2026-11-05 设计稿 Home / Phone-Home；11-11 第 11 批设计稿「P1 首页」改成两栏）：
//   问候一行       「早上好，Alex」，下面一小行日期和「n 件要你定，n 件在进行」（名字取网络显示名，取不到不带）；
//   左栏           要你处理 n（开着的要你定卡）→ 进行中 n（在跑、暂停、出错的后台线）→ 新的（最近交付、回顾、昨晚整理）；
//   右边窄栏       今天（日历和提醒）、接着读（最近的笔记 / 书 / 网页）、信息流（头条几条）。
// 手机一列：要你处理 → 进行中 → 今天 → 新的（接着读和信息流不出，手机在底栏和「更多」里）。
// 块之间只靠间距和小节标题区分；空的块不出现，全空时给直接开始的输入框。

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

/** 「1 件要你定，2 件在进行」：两样都没有就空。 */
function useSummary(): string {
  const live = useLive();
  const asks = useStore(live.asks.store);
  const list = useStore(live.lines.list);
  const doing = doingLines(list.lines).length;
  return [asks.open.length > 0 ? `${asks.open.length} 件要你定` : '', doing > 0 ? `${doing} 件在进行` : '']
    .filter((part) => part !== '').join('，');
}

/** 日期问候一行。手机上日期一小行、问候大一行，右边查找和头像（点了开设置）。 */
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
  // 日期在 DOM 里排前面（读屏先念日期），画在问候下面一小行。
  const title = <h1><span className="home-date">{summary === '' ? date : `${date} · ${summary}`}</span>
    <span>{hello}</span></h1>;
  if (!phone) {
    return <header className="home-greeting">{title}</header>;
  }
  return (
    <header className="home-greeting" data-phone="true">
      {title}
      <div className="home-greeting-tools">
        <IconButton icon="search" label="查找内容" size={18} onClick={() => openPanel({ kind: 'search' })} />
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
