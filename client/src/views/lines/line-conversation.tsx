import { useMainName } from '../mates/main-identity.tsx';
import { MateLineCard } from '../mates/mate-line-card.tsx';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { LineMessageView, LineSpeaker, LineView } from '../../api/shared.ts';
import type { AskView } from '../../api/types.ts';
import { splitQuotes } from '../../api/quote-text.ts';
import { PageCard } from '../conversation/page-card.tsx';
import { parsePageQuote } from '../conversation/page-snapshot.ts';
import { useLive, useTimeZone } from '../../live.tsx';
import { UserMessage } from '../../primitives/message/index.tsx';
import { Markdown } from '../../primitives/message/markdown.tsx';
import { QuoteSelection } from '../../primitives/message/quote-selection.tsx';
import { MateReport } from '../mates/mate-report.tsx';
import { Speaker, useSpeakerName } from '../mates/speaker.tsx';
import { LineCard } from './line-card.tsx';
import { parseLineRef, sideRoute } from '../../shell/routes.ts';
import { lineItemForSeq, useFocusMessage } from '../../shell/use-focus-message.ts';
import { useViewing } from '../../state/viewing.ts';
import { useRoute } from '../../shell/use-route.ts';
import { useStore } from '../../state/use-store.ts';
import { Icon } from '../../shell/icons.tsx';
import { useConversationUi } from './conversation-ui-context.tsx';
import { SideTopic } from './side-topic.tsx';
import { MessageRow, ThreadActionsProvider, type ThreadActions } from './thread-actions.tsx';
import { timeBreaks } from './time-breaks.ts';
import { AskPlaceProvider } from '../asks/ask-context.tsx';
import { useLineLabel } from '../asks/ask-labels.ts';
import { ConversationAsk } from '../asks/conversation-ask.tsx';
import { asksForConversation, waitingIn } from '../asks/conversation-asks.ts';
import { locateAsk, WaitingPin } from '../asks/waiting-pin.tsx';
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

const STICK_PX = 48;

function itemTime(item: TimelineItem): string | null {
  if (item.kind === 'user' || item.kind === 'input' || item.kind === 'report' || item.kind === 'notice'
    || item.kind === 'welcome' || item.kind === 'letter' || item.kind === 'handoff') {
    return item.message.createdAt;
  }
  if (item.kind === 'child') return item.line.createdAt;
  if (item.kind === 'ask') return item.placed.ask.createdAt;
  if (item.kind === 'side') return item.message.createdAt;
  return null;
}

function Tail({ data }: { data: LineThreadData }): ReactNode {
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
      return null;
    case 'paused':
      return <StateRow kind="pause" text={pausedText(line, timeZone)} action={action} />;
    case 'failed':
      return <StateRow kind="err" text={line.failure ?? '连不上模型'} action={action} />;
    case 'idle':
      return null;
  }
}

type QuoteMessage = (seq: number, text: string, author: string) => void;

function speakerOf(line: LineView | null): LineSpeaker {
  return line?.mateId == null ? { kind: 'main' } : { kind: 'mate', id: line.mateId };
}

function HandoffItem({ message, line, onQuote }: { message: LineMessageView; line: LineView | null;
  onQuote: QuoteMessage }): ReactNode {
  const from = message.relay?.from ?? { kind: 'main' as const };
  const author = useSpeakerName(from);
  return <MessageRow seq={message.seq} author={author} text={message.text}>
    <Speaker speaker={from} to={message.relay?.to} />
    <div className="line-answer line-handoff" data-message-seq={message.seq}>
      <QuoteSelection onQuote={(text) => onQuote(message.seq, text, author)}>
        <MessageContent text={message.text} />
      </QuoteSelection>
    </div>
    {line === null ? null : <LineCard line={line} stopped={line.outcome === 'stopped'} />}
  </MessageRow>;
}

function Item({ lineId, line, item, running, settled, streaming, onQuote }: { lineId: string;
  line: LineView | null; item: TimelineItem; running: boolean; onQuote: QuoteMessage;
  settled: boolean; streaming: string }): ReactNode {
  const mainName = useMainName();
  const speaker = speakerOf(line);
  const speakerName = useSpeakerName(speaker);
  switch (item.kind) {
    case 'user': {
      const { quotes, text } = splitQuotes(item.message.text, `line-${item.message.seq}`);
      const pages = new Map(quotes.flatMap((quote) => {
        const page = parsePageQuote(quote.text);
        return page === null ? [] : [[quote.id, page] as const];
      }));
      const shots = new Set([...pages.values()].flatMap((page) => (page.snapshotId === null ? [] : [page.snapshotId])));
      return <MessageRow seq={item.message.seq} author="你" text={text}>
        <UserMessage text={text} quotes={quotes} state="sent" replyTo={item.message.replyTo}
          content={<MessageContent text={text} markdown={false} />}
          renderQuote={(quote) => {
            const page = pages.get(quote.id);
            return page === undefined ? null : <PageCard quote={quote} page={page} />;
          }}
          attachments={<MessageAttachments ids={item.message.attachments.filter((id) => !shots.has(id))} />}
          onQuote={(selected) => onQuote(item.message.seq, selected, '你')} />
      </MessageRow>;
    }
    case 'input':
      return <LineInputRecord message={item.message}
        onQuote={(text) => onQuote(item.message.seq, text, messageAuthor(item.message))} />;
    case 'turn':
      return <TurnView lineId={lineId} turn={item} running={running} cutOff={settled && item.endedOnTool} quiet
        speaker={speaker} author={speakerName} streaming={running ? streaming : ''}
        onQuote={(seq, text) => onQuote(seq, text, speakerName)} />;
    case 'report':
      return <MateReport message={item.message} onQuote={onQuote} />;
    case 'handoff':
      return <HandoffItem message={item.message} line={item.line} onQuote={onQuote} />;
    case 'side':
      return <SideLink lineId={item.lineId} title={item.title} />;
    case 'child':
      return <MateLineCard line={item.line} />;
    case 'welcome':
      return <WelcomeMessage lineId={lineId} message={item.message} />;
    case 'letter':
      return <MessageRow seq={item.message.seq} author={mainName} text={item.message.text}>
        <Speaker speaker={{ kind: 'main' }} />
        <div className="line-answer" data-message-seq={item.message.seq}>
          <Markdown text={item.message.text} />
          {item.message.letter === undefined ? null : <LetterCard letter={item.message.letter} />}
        </div>
      </MessageRow>;
    case 'ask':
      return <ConversationAsk placed={item.placed} />;
    case 'notice':
      return <p className="line-notice" role="note" aria-label="系统通知" data-message-seq={item.message.seq}>
        <Icon name="bell" size={14} />
        <span>{item.message.text}</span>
      </p>;
  }
}

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

function NewMessages({ count, onJump }: { count: number; onJump: () => void }): ReactNode {
  return count <= 0 ? null : (
    <button type="button" className="line-new-pill" onClick={onJump}>
      <Icon name="arrow-down" size={12} />{count} 条新消息
    </button>
  );
}

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
  const atBottom = useRef(conversationUi.store.get().scroll.atBottom);
  const restored = useRef(false);
  const line = data.line;
  const placed = useMemo(() => asksForConversation(line, list.lines, [...asks.open, ...asks.deferred, ...asks.recent]),
    [line, list.lines, asks.open, asks.deferred, asks.recent]);
  const shown = useMemo(() => {
    const first = data.hasMore ? data.messages[0]?.createdAt ?? null : null;
    return placed.filter((item) => item.ask.status === 'open' || first === null || item.ask.createdAt >= first);
  }, [placed, data.hasMore, data.messages]);
  const items = useMemo(() => buildTimeline({ lineId: line?.id ?? null, messages: data.messages, lines: list.lines,
    summaries: data.summaries, asks: shown }), [line?.id, data.messages, list.lines, data.summaries, shown]);
  const lineLabel = useLineLabel();
  const askSource = (ask: AskView): string | null => {
    const from = placed.find((item) => item.ask.id === ask.id)?.from ?? null;
    if (from === null) return null;
    return from.mateId != null && from.mateId === line?.mateId ? from.title : lineLabel(from);
  };
  const running = line?.status === 'running';
  const tail = lastTurn(items);
  const streaming = data.live?.text ?? '';
  const quote: QuoteMessage = (seq, text, author) => {
    const sourceId = `line:${line?.id ?? lineId}:${seq}`;
    conversationUi.addQuote({ id: `quote:${sourceId}:${text}`, kind: 'message', sourceId, label: author, text });
    window.dispatchEvent(new Event(FOCUS_COMPOSER_EVENT));
  };
  const actions = useActionsFor(line, lineId, quote);
  const welcomeOnly = items.length === 1 && items[0]?.kind === 'welcome';
  const breaks = welcomeOnly ? [] : timeBreaks(items.map((item) => ({ at: itemTime(item) })), timeZone);
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
    const element = scroller.current;
    const column = element?.firstElementChild;
    if (element == null || column == null || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      if (atBottom.current) element.scrollTop = element.scrollHeight;
    });
    observer.observe(column);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (data.hasMore && scroller.current !== null && scroller.current.scrollTop === 0) {
      void live.lines.loadEarlier(lineId);
    }
  }, [data.hasMore, live.lines, lineId]);
  useViewing(line === null ? null : `line:${line.id}`);
  const { route } = useRoute();
  const wanted = parseLineRef(route.messageId);
  const focusSeq = wanted !== null && line !== null && wanted.lineId === line.id ? wanted.seq : null;
  const firstSeq = data.messages[0]?.seq ?? null;
  useFocusMessage(scroller, focusSeq === null || line === null ? null : {
    key: `${line.id}:${focusSeq}`, ready: data.loaded, busy: data.loadingEarlier,
    canLoadMore: data.hasMore && (firstSeq === null || firstSeq > focusSeq),
    loadMore: () => void live.lines.loadEarlier(lineId),
    find: (root) => lineItemForSeq(root, focusSeq),
  }, () => {
    atBottom.current = false;
  });
  return (
    <ThreadActionsProvider value={actions}>
    <AskPlaceProvider place={{ kind: 'line', lineId: line?.id ?? lineId }} source={askSource}>
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
                <Item lineId={line?.id ?? lineId} line={line} item={item} running={current} streaming={streaming}
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
          <Tail data={data} />
        </div>
      </div>
      <div className="line-composer-dock">
        <NewMessages count={unread} onJump={jump} />
        <div className="line-column">
          <WaitingPin asks={waitingIn(placed)} onLocate={(askId) => locateAsk(scroller.current, askId)} />
          {data.line?.archivedAt == null ? <LineComposer lineId={lineId} askPage={askPage}
            side={line?.kind === 'side'} /> : null}
        </div>
      </div>
    </section>
    </AskPlaceProvider>
    </ThreadActionsProvider>
  );
}
