// 和 Plasticine 的对话（2026-11-05 Harness 重做，消息里的 Plasticine 和右下的对话框共用这一份）：读主对话那条线。
// 你的话是气泡；Plasticine 的一轮是普通文字，上面「想了 n 秒 ›」「做了 n 步 ›」；干活时最下面只有一行实时状态；
// 后台线是对话里的一张卡；等你定的卡在等你的那一轮下面摊开；额度暂停、连不上模型各一行。输入框在最下面。
// 内容不满一屏时贴着底部；在底部时新内容来了跟着往下，往上翻着看的时候不打扰。
// 《优化清单》第 17 条（11-07 设计稿 Plasticine-Main / Side）：主线和旁聊共用这一份；对话里只有说给人听的话（不画
// 想了 / 做了几步，子代理的步骤在它的卡里）；消息之间按时间分隔；悬停一条出表情、回复、更多；往上翻着时来了新消息出
// 「n 条新消息」；旁聊顶上是它围绕的那一条。

import { MateLineCard } from '../mates/mate-line-card.tsx';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { LineView } from '../../api/shared.ts';
import type { AskView } from '../../api/types.ts';
import { splitQuotes } from '../../api/quote-text.ts';
import { useLive, useTimeZone } from '../../live.tsx';
import { UserMessage } from '../../primitives/message/index.tsx';
import { Markdown } from '../../primitives/message/markdown.tsx';
import { MateReport } from '../mates/mate-report.tsx';
import { sideRoute } from '../../shell/routes.ts';
import { useRoute } from '../../shell/use-route.ts';
import { useStore } from '../../state/use-store.ts';
import { Icon } from '../../shell/icons.tsx';
import { useConversationUi } from './conversation-ui-context.tsx';
import { SideTopic } from './side-topic.tsx';
import { MessageRow, ThreadActionsProvider, type ThreadActions } from './thread-actions.tsx';
import { timeBreaks } from './time-breaks.ts';
import { LineAskCard } from '../asks/line-ask-card.tsx';
import { FOCUS_COMPOSER_EVENT, LineComposer } from './line-composer.tsx';
import { LineInputRecord } from './line-input-record.tsx';
import { messageAuthor } from './line-origin.ts';
import { LiveRow, StateRow } from './line-parts.tsx';
import { activityText, lineElapsed, pausedText, useNow } from './line-time.ts';
import type { LineThreadData } from './line-thread-data.ts';
import { buildTimeline, lastTurn, seqRange, type TimelineItem } from './timeline.ts';
import { TurnView } from './turn-view.tsx';
import { WelcomeMessage } from './welcome-message.tsx';
import { LetterCard } from '../spaces/letter-card.tsx';
import { WorkLineAction } from './work-status.tsx';
import { MessageAttachments } from '../conversation/message-attachments.tsx';
import { MessageContent } from '../conversation/message-content.tsx';
import './lines.css';
import './chat-details.css';

/** 离底部这么近算「在底部」：新内容来了跟着滚。 */
const STICK_PX = 48;

function itemTime(item: TimelineItem): string | null {
  if (item.kind === 'user' || item.kind === 'input' || item.kind === 'report' || item.kind === 'notice'
    || item.kind === 'welcome' || item.kind === 'letter') {
    return item.message.createdAt;
  }
  if (item.kind === 'child') return item.line.createdAt;
  if (item.kind === 'side') return item.message.createdAt;
  // 一轮跟着它前面那条走，不单独标时间。
  return null;
}

/** 在等你定的这一轮下面摊开的卡：卡上写着是哪条线（lineId）；这一轮开始以前出的不算（早先没答的在首页「等你」里）。 */
function waitingAsks(open: readonly AskView[], lineId: string, since: string | null): AskView[] {
  return open.filter((ask) => ask.lineId === lineId && (since === null || ask.createdAt >= since));
}

function Tail({ data, asks }: { data: LineThreadData; asks: readonly AskView[] }): ReactNode {
  const timeZone = useTimeZone();
  const [error, setError] = useState<string | null>(null);
  const line = data.line;
  const now = useNow(line?.status === 'running');
  if (line === null) {
    return null;
  }
  const action = <><WorkLineAction line={line} onError={setError} />
    {error === null ? null : <span className="line-note is-error" role="alert">{error}</span>}</>;
  switch (line.status) {
    case 'queued':
      return <StateRow kind="pause" text="排队中" action={action} />;
    case 'running': {
      const tool = data.live?.tools.findLast((item) => item.ok === null);
      const text = line.activity ?? (tool === undefined ? activityText(line) : `${tool.say}…`);
      return <LiveRow text={text} elapsed={lineElapsed(line, now)} />;
    }
    case 'waiting':
      return <>{asks.map((ask) => <LineAskCard key={ask.id} ask={ask} />)}</>;
    case 'paused':
      return <StateRow kind="pause" text={pausedText(line, timeZone)} action={action} />;
    case 'failed':
      return <StateRow kind="err" text={line.failure ?? '连不上模型'} action={action} />;
    case 'idle':
      return null;
  }
}

type QuoteMessage = (seq: number, text: string, author: string) => void;

function Item({ lineId, item, running, settled, streaming, onQuote }: { lineId: string; item: TimelineItem;
  running: boolean; onQuote: QuoteMessage;
  /**
   * 最后一项、线空闲：停在半路的一轮按「停下了」画。不是最后一项的不算：后面跟着他的话时分不清是叫停后又说的，
   * 还是「立即发送」插进来的（那一轮没停）。
   */
  settled: boolean; streaming: string }): ReactNode {
  switch (item.kind) {
    case 'user': {
      const { quotes, text } = splitQuotes(item.message.text, `line-${item.message.seq}`);
      return <MessageRow seq={item.message.seq} author="你" text={text}>
        <UserMessage text={text} quotes={quotes} state="sent" replyTo={item.message.replyTo}
          content={<MessageContent text={text} markdown={false} />}
          attachments={<MessageAttachments ids={item.message.attachments} />}
          onQuote={(selected) => onQuote(item.message.seq, selected, '你')} />
      </MessageRow>;
    }
    case 'input':
      return <LineInputRecord message={item.message}
        onQuote={(text) => onQuote(item.message.seq, text, messageAuthor(item.message))} />;
    case 'turn':
      return <TurnView lineId={lineId} turn={item} running={running} cutOff={settled && item.endedOnTool} quiet
        streaming={running ? streaming : ''} onQuote={(seq, text) => onQuote(seq, text, 'Plasticine')} />;
    case 'report':
      return <MateReport message={item.message} onQuote={onQuote} />;
    case 'side':
      return <SideLink lineId={item.lineId} title={item.title} />;
    case 'child':
      return <MateLineCard line={item.line} />;
    case 'welcome':
      return <WelcomeMessage lineId={lineId} message={item.message} />;
    case 'letter':
      return <MessageRow seq={item.message.seq} author="Plasticine" text={item.message.text}>
        <div className="line-answer" data-message-seq={item.message.seq}>
          <Markdown text={item.message.text} />
          {item.message.letter === undefined ? null : <LetterCard letter={item.message.letter} />}
        </div>
      </MessageRow>;
    case 'notice':
      return <p className="line-notice" role="note" aria-label="系统通知" data-message-seq={item.message.seq}>
        <Icon name="bell" size={14} />
        <span>{item.message.text}</span>
      </p>;
  }
}

/** Plasticine 把话题挪到了旁聊：一行入口（线条图标 · 旁聊 · 标题 ›），点了过去。 */
function SideLink({ lineId, title }: { lineId: string; title: string }): ReactNode {
  const { navigate } = useRoute();
  return (
    <button type="button" className="line-side-link" onClick={() => navigate(sideRoute(lineId))}>
      <Icon name="thread" size={14} />
      <span className="line-side-kind">对话</span>
      <span className="line-side-title">{title}</span>
      <Icon name="chevron-right" size={12} />
    </button>
  );
}

/** 往上翻着看时来了新消息：浮在输入框上面的小条，点了回到最新。 */
function NewMessages({ count, onJump }: { count: number; onJump: () => void }): ReactNode {
  return count <= 0 ? null : (
    <button type="button" className="line-new-pill" onClick={onJump}>
      <Icon name="arrow-down" size={12} />{count} 条新消息
    </button>
  );
}

/** AI 对话的悬停条：引用整条、更多；没有表情（11-12）。 */
function useActionsFor(line: LineView | null, lineId: string, quote: QuoteMessage): ThreadActions {
  const live = useLive();
  const data = useStore(live.lines.thread(lineId));
  return {
    lineId: line?.id ?? lineId,
    message: (seq) => data.messages.find((message) => message.seq === seq),
    quote: (seq, author, text) => quote(seq, text, author),
  };
}

export interface LineConversationProps {
  lineId: string;
  /** 对话框里才有「问这一页」。 */
  askPage: boolean;
}

export function LineConversation({ lineId, askPage }: LineConversationProps): ReactNode {
  const live = useLive();
  const conversationUi = useConversationUi();
  const timeZone = useTimeZone();
  const data = useStore(live.lines.thread(lineId));
  const list = useStore(live.lines.list);
  const asks = useStore(live.asks.store);
  const scroller = useRef<HTMLDivElement>(null);
  // 滚动位置记在 state/（对话框收起再展开、换容器、切页回来都在）：贴底的接着贴底，往上翻着的回到原处。
  const atBottom = useRef(conversationUi.store.get().scroll.atBottom);
  const restored = useRef(false);
  const line = data.line;
  const items = useMemo(() => buildTimeline({ lineId: line?.id ?? null, messages: data.messages, lines: list.lines,
    summaries: data.summaries }), [line?.id, data.messages, list.lines, data.summaries]);
  const running = line?.status === 'running';
  const tail = lastTurn(items);
  const lastUser = [...items].reverse().find((item) => item.kind === 'user');
  const since = lastUser?.kind === 'user' ? lastUser.message.createdAt : null;
  const waiting = line?.status === 'waiting' ? waitingAsks(asks.open, line.id, since) : [];
  // 样刊附的「开启定时」卡不挂在哪条线上（第 7 批第 14 条）：开着就摊在主线最下面，答了就收起。
  const sampleCards = line?.kind === 'main' ? asks.open.filter((ask) => ask.subscriptionCard !== undefined) : [];
  const streaming = data.live?.text ?? '';
  const quote: QuoteMessage = (seq, text, author) => {
    const sourceId = `line:${line?.id ?? lineId}:${seq}`;
    conversationUi.addQuote({ id: `quote:${sourceId}:${text}`, kind: 'message', sourceId, label: author, text });
    window.dispatchEvent(new Event(FOCUS_COMPOSER_EVENT));
  };
  const actions = useActionsFor(line, lineId, quote);
  // 只有建账号时那条欢迎（设计稿 First-Main）：从上往下排、不画时间分隔，像 Plasticine 先开口。
  const welcomeOnly = items.length === 1 && items[0]?.kind === 'welcome';
  const breaks = welcomeOnly ? [] : timeBreaks(items.map((item) => ({ at: itemTime(item) })), timeZone);
  // 往上翻开时记下那时有几项；之后多出来的就是「n 条新消息」（回到底部清掉）。
  const [awayAt, setAwayAt] = useState<number | null>(null);
  const unread = awayAt === null ? 0 : items.length - awayAt;
  const jump = (): void => {
    const element = scroller.current;
    if (element !== null) {
      element.scrollTop = element.scrollHeight;
    }
    atBottom.current = true;
    setAwayAt(null);
  };
  // 他自己发了一句：回到最新（不算「新消息」）。
  const pendingCount = data.pending.length;
  const sentBefore = useRef(pendingCount);
  useEffect(() => {
    if (pendingCount > sentBefore.current) jump();
    sentBefore.current = pendingCount;
  });
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element === null) {
      return;
    }
    if (!restored.current) {
      restored.current = true;
      const saved = conversationUi.store.get().scroll;
      if (!saved.atBottom) {
        element.scrollTop = saved.scrollTop;
        return;
      }
    }
    if (atBottom.current) {
      element.scrollTop = element.scrollHeight;
    }
  });
  useEffect(() => {
    if (data.hasMore && scroller.current !== null && scroller.current.scrollTop === 0) {
      void live.lines.loadEarlier(lineId);
    }
  }, [data.hasMore, live.lines, lineId]);
  return (
    <ThreadActionsProvider value={actions}>
    <section className="line-conv" aria-label="对话" data-kind={line?.kind}>
      <div ref={scroller} className="line-scroll" role="log" aria-label="对话记录" data-welcome-only={welcomeOnly}
        onScroll={(event) => {
        const element = event.currentTarget;
        atBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < STICK_PX;
        setAwayAt((away) => (atBottom.current ? null : away ?? items.length));
        conversationUi.saveScroll({ atBottom: atBottom.current, scrollTop: element.scrollTop });
        if (element.scrollTop < STICK_PX && data.hasMore) {
          void live.lines.loadEarlier(lineId);
        }
      }}>
        <div className="line-column">
          {line?.topic == null ? null : <SideTopic topic={line.topic} />}
          {data.error === null ? null : (
            <p className="line-note is-error" role="alert">
              {data.error}{' '}
              <button type="button" className="text-button" onClick={() => void live.lines.loadLatest(lineId)}>
                再读一次
              </button>
            </p>
          )}
          {items.map((item, index) => {
            const label = breaks[index] ?? null;
            const current = running && item === tail;
            const range = seqRange(item);
            return (
              <div key={item.key} className="line-item" data-kind={item.kind} data-seq-from={range?.[0]}
                data-seq-to={range?.[1]}>
                {label === null ? null : <div className="line-day">{label}</div>}
                <Item lineId={line?.id ?? lineId} item={item} running={current} streaming={streaming}
                  settled={item === items.at(-1) && line?.status === 'idle'} onQuote={quote} />
              </div>
            );
          })}
          {running && tail === null && streaming !== '' ? (
            <div className="line-answer"><Markdown text={streaming} /></div>
          ) : null}
          {data.pending.map((item) => (
            <UserMessage key={item.requestId} text={item.text} quotes={[]} replyTo={item.replyTo}
              content={<MessageContent text={item.text} markdown={false} />}
              attachments={<MessageAttachments ids={item.attachments} />}
              state={item.status === 'failed' ? 'failed' : 'sending'} error={item.error}
              onResend={() => void live.lines.resend(lineId, item.requestId)}
              onDiscard={() => {
                const text = live.lines.discard(lineId, item.requestId);
                if (text !== null) conversationUi.restoreToComposer(text, []);
              }} />
          ))}
          {sampleCards.map((ask) => <LineAskCard key={ask.id} ask={ask} />)}
          <Tail data={data} asks={waiting} />
        </div>
      </div>
      <div className="line-composer-dock">
        <NewMessages count={unread} onJump={jump} />
        <div className="line-column">
          {data.line?.archivedAt == null ? <LineComposer lineId={lineId} askPage={askPage}
            side={line?.kind === 'side'} /> : null}
        </div>
      </div>
    </section>
    </ThreadActionsProvider>
  );
}
