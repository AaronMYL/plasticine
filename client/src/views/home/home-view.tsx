// 首页「现在」（2026-11-05 设计稿 Home / Phone-Home）。从上到下：
//   日期问候一行   「11月5日 星期四  晚上好，Alex」（名字取网络显示名，取不到不带），没有副标题；
//   等你 n         开着的要你定卡，一行一件（home-now.tsx）；
//   在做           在跑的后台线，一行一条实时状态，能叫停（home-now.tsx）；
//   今天           他 Mac 上的 Apple 日历和提醒事项（第 15 条，设计稿 Main / Phone-Now）；
//   回顾           最近一期个人回顾的一句、昨晚整理了几条（home-review.tsx，第 7 条）；
//   接着看         最近的笔记 / 书 / 网页（手机上没有：书和网页标签手机上都不出现）；
//   信息流         头条 3 条，只在电脑上（手机的信息流在底栏）。
// 单列最宽 880，块之间只靠间距和小节标题区分；空的块不出现，全空时给直接开始的输入框。

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
import { HomeDoing, HomeWaiting } from './home-now.tsx';
import { HomeResults } from './home-results.tsx';
import { HomeReview } from './home-review.tsx';
import { HomeStart } from './home-start.tsx';
import './home.css';
import './home-work.css';

/** 日期问候一行。手机上日期一小行、问候大一行，右边查找和头像（点了开设置）。 */
function Greeting({ now, phone }: { now: Date; phone: boolean }): ReactNode {
  const live = useLive();
  const openPanel = useOpenPanel();
  const timeZone = useTimeZone();
  useEffect(() => live.network.status.open(), [live.network.status]);
  const name = useStore(live.network.status.data).value?.account?.displayName ?? null;
  const { date, hello } = greetingOf(now, name, timeZone);
  if (!phone) {
    return (
      <header className="home-greeting">
        <h1><span className="home-date">{date}</span><span>{hello}</span></h1>
      </header>
    );
  }
  return (
    <header className="home-greeting" data-phone="true">
      <h1><span className="home-date">{date}</span><span>{hello}</span></h1>
      <div className="home-greeting-tools">
        <IconButton icon="search" label="查找内容" size={18} onClick={() => openPanel({ kind: 'search' })} />
        <button type="button" className="avatar home-avatar" aria-label={`设置 · ${name ?? DEFAULT_ACCOUNT_NAME}`}
          onClick={() => openPanel({ kind: 'settings' })}>{accountInitial(name ?? DEFAULT_ACCOUNT_NAME)}</button>
      </div>
    </header>
  );
}

export function HomeView({ now = new Date() }: { now?: Date }): ReactNode {
  const phone = useViewportWidth() < PHONE_BELOW;
  return (
    <div className="page home" data-device={phone ? 'phone' : 'desktop'}>
      <Greeting now={now} phone={phone} />
      <HomeWaiting phone={phone} />
      <HomeDoing phone={phone} />
      <TodayBlock now={now} phone={phone} />
      <HomeResults now={now} />
      <HomeReview />
      <HomeStart phone={phone} />
      {phone ? null : <ContinueBlock now={now} />}
      <FeedHeadlines now={now} phone={phone} />
    </div>
  );
}
