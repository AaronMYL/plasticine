// 和 Plasticine 说话的输入框（2026-11-05 设计稿 Main）：近白底、圆角 12。排队的消息在框里、字的上面，一条一行：
// 钟 · 那句话 ·「立即发送」（悬停浮框说明这一步做完就插进去，不等整轮）· 撤回 ×。干活时发送键左边是停止键。
// Enter 发送、Shift+Enter 换行，中文输入法选字时的 Enter 不发送；手机上回车换行，点发送键发。
// 草稿、引用片、附件在 state/（对话框收起、换容器、切页回来字都在）。引用片照旧写成引用块放在正文前面。

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { LINE_MESSAGE_MAX_CHARS, quoteLimitMessage, type QueuedMessageView } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { QuotePreview } from '../../primitives/message/quote-preview.tsx';
import { Icon } from '../../shell/icons.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { PHONE_BELOW } from '../../shell/layout.ts';
import { useViewportWidth } from '../../shell/use-viewport-width.ts';
import { useCurrentTab } from '../../shell/current-tab-context.ts';
import { routeHash } from '../../shell/routes.ts';
import { currentPageReference } from '../conversation/current-page-reference.ts';
import { splitReply } from '../../api/shared.ts';
import { useComposerAttachments, useConversationUi } from './conversation-ui-context.tsx';
import { useStore } from '../../state/use-store.ts';
import { AttachmentChips, AttachmentComposer } from '../conversation/attachment-composer.tsx';
import { AskPageToggle, PageSource, PAGE_UNREAD_NOTE, usePageContext }
  from '../conversation/ask-page-toggle.tsx';
import { ModelPicker } from '../models/model-picker.tsx';
import { StopButton } from './line-parts.tsx';
import { inputAuthor } from './line-origin.ts';
import './line-composer.css';

/** 浏览器在输入法组合期间按键给的 keyCode（老 Safari 不设 isComposing，只给这个）。 */
const IME_KEY_CODE = 229;
export const FOCUS_COMPOSER_EVENT = 'plasticine:focus-composer';
const SEND_NOW_TIP = '这一步做完就插进去，不等整轮';

function QueueRow({ lineId, item }: { lineId: string; item: QueuedMessageView }): ReactNode {
  const live = useLive();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 线在跑时「立即发送」是这一步做完才插进去：送到之后这一行写「下一步插进去」，不再给按钮。服务端记着这一态
  // （inserted），刷新后照旧。
  const [steering, setSteering] = useState(false);
  const inserted = steering || item.status === 'inserted';
  const run = (work: () => Promise<string | null>, done?: () => void): void => {
    setBusy(true);
    void work().then((problem) => {
      setBusy(false);
      setError(problem);
      if (problem === null) done?.();
    });
  };
  return (
    <li className="line-queued" aria-label={`排队的消息：${item.text}`}>
      <span className="line-queued-icon" aria-hidden="true"><Icon name="clock" size={13} /></span>
      {item.origin.kind === 'user' ? null : <span className="line-queued-author">{inputAuthor(item.origin)}</span>}
      <span className="line-queued-text">{splitReply(item.text).text}</span>
      {error === null ? null : <span className="line-queued-error" role="alert">{error}</span>}
      {inserted ? <span className="line-queued-state" role="status">下一步插进去</span> : (
        <button type="button" className="text-button line-queued-now" data-tip={SEND_NOW_TIP} disabled={busy}
          onClick={() => run(() => live.lines.sendNow(lineId, item.id), () => setSteering(true))}>立即发送</button>
      )}
      <IconButton icon="close" size={12} label="撤回" className="line-queued-withdraw" disabled={busy}
        onClick={() => run(() => live.lines.withdraw(lineId, item.id))} />
    </li>
  );
}

export interface LineComposerProps {
  lineId: string;
  /** 对话框里（不是消息里那一整页）才有「问这一页」。 */
  askPage: boolean;
  /** 旁聊：模型按钮改的是旁聊用途（side），占位字写「在旁聊里接着说」。 */
  side?: boolean;
}

/** 正要回复的那一条：输入框上面一行「回复 Plasticine：……」，× 取消。 */
function ReplyChip({ author, text, onCancel }: { author: string; text: string; onCancel: () => void }): ReactNode {
  return (
    <div className="line-reply-chip" role="group" aria-label="正在回复">
      <Icon name="reply" size={12} />
      <span className="line-reply-chip-text">回复 {author}：{text}</span>
      <IconButton icon="close" size={12} label="不回复这条" onClick={onCancel} />
    </div>
  );
}

export function LineComposer({ lineId, askPage, side = false }: LineComposerProps): ReactNode {
  const live = useLive();
  const api = useApi();
  const attachments = useComposerAttachments();
  const conversationUi = useConversationUi();
  const thread = useStore(live.lines.thread(lineId));
  const { draft, quotes, reply } = useStore(conversationUi.store);
  const drafts = useStore(attachments.store);
  const ready = drafts.filter((item) => !item.canceled);
  const phone = useViewportWidth() < PHONE_BELOW;
  const input = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const shortcutId = useId();
  const page = usePageContext(askPage);
  const currentTab = useCurrentTab();
  const sourceKey = JSON.stringify([currentTab?.id, currentTab?.url,
    currentTab?.route == null ? null : routeHash(currentTab.route)]);
  const tabRef = useRef(sourceKey);
  tabRef.current = sourceKey;
  const sending = useRef(false);
  const mounted = useRef(true);
  const [preparing, setPreparing] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const [stopping, setStopping] = useState(false);
  const line = thread.line;
  const working = line?.status === 'running';
  // 一句话最多 2 万字（LINE_MESSAGE_MAX_CHARS），引用另算（结构化发，上限见 quoteLimitMessage）：超了先说，不等服务端退回。
  const quoteLimit = quoteLimitMessage(quotes) ?? (draft.trim().length > LINE_MESSAGE_MAX_CHARS
    ? `一句话最多 ${LINE_MESSAGE_MAX_CHARS.toLocaleString('zh-CN')} 字，这次超了；拆开发，长材料用附件。`
    : null);
  useEffect(() => {
    const focus = (): void => input.current?.focus({ preventScroll: true });
    window.addEventListener(FOCUS_COMPOSER_EVENT, focus);
    return () => window.removeEventListener(FOCUS_COMPOSER_EVENT, focus);
  }, []);
  const canSend = !preparing && !page.blocked && quoteLimit === null && attachments.ready()
    && (draft.trim() !== '' || quotes.length > 0 || ready.length > 0);

  const send = (): void => {
    if (!canSend || sending.current) return;
    sending.current = true;
    setPreparing(true);
    setSendError(null);
    const original = { draft, quotes, reply, attachments: attachments.store.get() };
    const prepare = async (): Promise<void> => {
      try {
        const full = askPage ? await page.quoteFor(original.quotes) : null;
        const pageQuote = full ?? (askPage ? await currentPageReference(currentTab, api) : null);
        if (!mounted.current) return;
        if (tabRef.current !== sourceKey) {
          throw new Error('当前页已经改变，请在新页面重新发送。');
        }
        const current = conversationUi.store.get();
        if (current.draft !== original.draft || current.quotes !== original.quotes
          || attachments.store.get() !== original.attachments) {
          throw new Error('内容有更新，请再发一次。');
        }
        const all = pageQuote === null ? original.quotes : [...original.quotes, pageQuote];
        const limit = quoteLimitMessage(all);
        if (limit !== null) throw new Error(limit);
        const sentAttachments = attachments.takeReady().map((item) => item.id);
        // 先交给线的待发记录，再清空草稿；来源预读失败不会来到这里。
        const delivery = live.lines.send(lineId, original.draft.trim(), sentAttachments, all, original.reply);
        conversationUi.clearComposer();
        if (!phone) input.current?.focus({ preventScroll: true });
        if (await delivery) page.committed(pageQuote);
      } catch (cause) {
        const error = errorText(cause);
        if (mounted.current && error !== PAGE_UNREAD_NOTE) setSendError(error);
      } finally {
        sending.current = false;
        if (mounted.current) setPreparing(false);
      }
    };
    void prepare();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter' || event.shiftKey || (phone && !event.metaKey && !event.ctrlKey)) {
      return;
    }
    if (composing.current || event.nativeEvent.isComposing || event.keyCode === IME_KEY_CODE) {
      return;
    }
    event.preventDefault();
    send();
  };

  const stop = (): void => {
    setStopping(true);
    void live.lines.stopLine(lineId).finally(() => setStopping(false));
  };

  return (
    <form className="line-composer" onSubmit={(event) => { event.preventDefault(); send(); }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault();
      }}
      onDrop={(event) => {
        if (event.dataTransfer.files.length > 0) {
          event.preventDefault();
          void attachments.add(Array.from(event.dataTransfer.files), api.attachments);
        }
      }}>
      {quoteLimit === null ? null : <p className="line-composer-note is-error" role="alert">{quoteLimit}</p>}
      {sendError === null ? null : <p className="line-composer-note is-error" role="alert">{sendError}</p>}
      <div className="line-input-box" aria-busy={preparing}>
        {thread.queue.length === 0 ? null : (
          <ul className="line-queue" aria-label="排队的消息">
            {thread.queue.map((item) => <QueueRow key={item.id} lineId={lineId} item={item} />)}
          </ul>
        )}
        {reply === null ? null : <ReplyChip author={reply.author} text={reply.text}
          onCancel={() => conversationUi.setReply(null)} />}
        {quotes.length === 0 ? null : (
          <div className="line-quotes" aria-label="引用片">
            {quotes.map((quote) => (
              <QuotePreview key={quote.id} quote={quote} onRemove={() => conversationUi.removeQuote(quote.id)} />
            ))}
          </div>
        )}
        <AttachmentChips />
        {askPage ? <PageSource context={page} /> : null}
        <textarea ref={input} className="line-input" aria-label="问一句" aria-describedby={shortcutId}
          placeholder={side ? '在旁聊里接着说' : '回复 Plasticine'} rows={1} value={draft}
          onChange={(event) => conversationUi.setDraft(event.target.value)}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files);
            if (files.length > 0) {
              event.preventDefault();
              void attachments.add(files, api.attachments);
            }
          }}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={() => { composing.current = false; }}
          onKeyDown={onKeyDown} />
        <div className="line-input-tools">
          <AttachmentComposer />
          <ModelPicker purpose={side ? 'side' : 'main'} />
          <span className="line-input-spacer" />
          {askPage ? <AskPageToggle context={page} /> : null}
          {working ? <StopButton onStop={stop} busy={stopping} large={phone} /> : null}
          <button type="submit" className="line-send" aria-label="发送" data-tip={phone ? '发送' : '发送（Enter）'}
            disabled={!canSend}>
            <Icon name="send" />
          </button>
        </div>
      </div>
      <span id={shortcutId} className="sr-only">
        {phone ? '回车换行，点发送按钮发送。' : 'Enter 发送，Shift Enter 换行。'}
      </span>
    </form>
  );
}
