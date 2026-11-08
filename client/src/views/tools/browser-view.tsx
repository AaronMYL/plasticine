// 浏览器页：一行小页头（浏览器 · 返回），地址就地编辑，标签页和导航在顶部，下面是可操作的服务器画面。
import { useRef, useState, type ReactNode } from 'react';
import { BrowserSurface } from './browser-surface.tsx';
import { useBrowserSession } from './use-browser-session.ts';
import { useBrowserViewport } from './use-browser-viewport.ts';
import { browserAddress } from './browser-address.ts';
import { BrowserActions } from './browser-actions.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { Icon } from '../../shell/icons.tsx';
import './tools.css';
import './browser.css';

export function BrowserView({ onBack }: { onBack(): void }): ReactNode {
  const container = useRef<HTMLDivElement>(null);
  const keyboard = useRef<HTMLTextAreaElement>(null);
  const viewport = useBrowserViewport(container);
  const session = useBrowserSession(viewport);
  const [draft, setDraft] = useState<string | null>(null);
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  const { view } = session;
  // 地址直接来自最新导航状态，只有用户正在编辑时才用草稿；迟到的状态不会覆盖输入。
  const address = draft ?? (view?.url === 'about:blank' ? '' : view?.url ?? '');
  const navigate = (): void => {
    if (address.trim() !== '') {
      session.open(browserAddress(address), () => {
        if (latestDraft.current === address) {
          setDraft(null);
        }
      });
    }
  };
  const unavailable = view?.available === false;
  return (
    <div className="browser-tool">
      <header className="browser-head" aria-label="浏览器页头">
        <h1 className="browser-head-title">浏览器</h1>
        <button type="button" className="text-button browser-return" onClick={onBack}>
          <Icon name="back" />返回
        </button>
      </header>
      {view?.controller === 'brain' ? <p className="browser-control text-meta" role="status">
        <span className="dot dot-run" aria-hidden="true" />Plasticine 正在用这个浏览器 · 你一操作就接手
      </p> : null}
      <div className="browser-toolbar" role="group" aria-label="浏览器导航">
        <IconButton icon="back" label="后退" className="browser-history"
          disabled={!view?.open || unavailable}
          onClick={() => session.action({ kind: 'back' })} />
        <IconButton icon="chevron-right" label="前进" className="browser-history"
          disabled={!view?.open || unavailable}
          onClick={() => session.action({ kind: 'forward' })} />
        <input className="field-input browser-address" aria-label="地址栏" placeholder="输入网址或搜索"
          value={address} autoComplete="off" spellCheck={false}
          onBlur={() => setDraft(null)}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault();
              navigate();
            }
          }} />
        <IconButton icon={view?.loading ? 'close' : 'refresh'} label={view?.loading ? '停止加载' : '刷新'}
          disabled={!view?.open || unavailable}
          onClick={() => session.action({ kind: view?.loading ? 'stop' : 'reload' })} />
        <IconButton icon="keyboard" label="键盘" className="browser-keyboard-toggle"
          disabled={session.inputPaused || unavailable}
          onClick={() => keyboard.current?.focus({ preventScroll: true })} />
        <BrowserActions onAction={session.tab} />
      </div>
      <div className="browser-tabs-row">
        <div className="browser-tabs" role="tablist" aria-label="浏览器标签页">
          {(view?.tabs ?? []).map((tab) => <div className="browser-tab" key={tab.id}>
            <button type="button" role="tab" aria-selected={view?.activeTabId === tab.id}
              className="browser-tab-title" title={tab.title || tab.url}
              onClick={() => session.tab({ kind: 'switch', tabId: tab.id })}>
              {tab.title || '新标签页'}
            </button>
            <IconButton icon="close" className="browser-tab-close" label={`关掉「${tab.title || '新标签页'}」`}
              onClick={() => session.tab({ kind: 'close', tabId: tab.id })} />
          </div>)}
        </div>
        <IconButton icon="plus" label="新开标签页" disabled={unavailable}
          onClick={() => session.tab({ kind: 'new' })} />
      </div>
      {session.error !== null || unavailable ? <div className="browser-notice" role="status">
        <p className="tool-sub">{unavailable ? '浏览器还没起来' : session.error}</p>
        <button type="button" className="chip-button" onClick={session.retry}>重试</button>
      </div> : null}
      <div className="browser-viewport" ref={container}>
        {view?.open ? <BrowserSurface frame={session.frame} disabled={session.inputPaused} keyboardRef={keyboard}
          onAction={session.action} onAck={session.ack}
          onError={session.reportError} /> : <p className="block-empty browser-empty">
          {unavailable ? '连接后就能在这里浏览。' : '打开一个网址，或新开标签页。'}
        </p>}
      </div>
    </div>
  );
}
