// 手机从引用和搜索承接同一对象；复制、返回与继续讨论都保留对象身份和阅读位置。
import { useEffect, useState, type ReactNode } from 'react';
import type { Quote } from '../../api/types.ts';
import { quoteLimitMessage } from '../../api/shared.ts';
import { errorText } from '../../api/errors.ts';
import { useClientState } from '../../state/context.tsx';
import { useRememberedScroll } from '../../state/use-remembered-scroll.ts';
import { useStore } from '../../state/use-store.ts';
import { IconButton } from '../../shell/icon-button.tsx';
import { Icon } from '../../shell/icons.tsx';
import { HOME, navLabel, parseHash, routeHash, type Route } from '../../shell/routes.ts';
import { useRoute } from '../../shell/use-route.ts';
import { useNavHistory } from '../../shell/nav-history.ts';
import { useOpenPanel } from '../../shell/panel.ts';
import './phone-content.css';

export interface PhoneContentProps {
  route: Route;
  children: ReactNode;
  quote?: Quote | null;
  ready?: boolean;
  onBack?: (() => void) | undefined;
  navigate: (route: Route) => void;
}

export function PhoneContent({ route, children, quote = null, ready = true, onBack, navigate }: PhoneContentProps)
  : ReactNode {
  const { conversationUi, shellPrefs } = useClientState();
  const openPanel = useOpenPanel();
  const history = useRoute();
  const nav = useNavHistory();
  const hash = routeHash(route);
  const scroll = useRememberedScroll<HTMLDivElement>(`phone-content:${hash}`, ready);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setMessage(null); setError(null); }, [hash]);
  const back = (): void => {
    if (onBack !== undefined && nav.canBack) onBack();
    else if (history.canGoBack) history.goBack();
    else navigate(HOME);
  };
  const copy = async (): Promise<void> => {
    try {
      if (navigator.clipboard === undefined) throw new Error('当前浏览器不能复制，请复制地址栏中的链接。');
      await navigator.clipboard.writeText(new URL(hash, window.location.href).href);
      setError(null);
      setMessage('链接已复制');
    } catch (cause) { setError(errorText(cause)); }
  };
  const mention = (): void => {
    if (quote === null) return;
    const limit = quoteLimitMessage([...conversationUi.store.get().quotes, quote]);
    if (limit !== null) { setError(limit); return; }
    conversationUi.addQuote(quote);
    shellPrefs.setPhoneChatOpen(true);
  };
  return (
    <div className="phone-content">
      <header className="phone-content-head">
        <IconButton icon="back" size={20} label="返回" onClick={back} />
      </header>
      <div ref={scroll.ref} className="phone-content-scroll" onScroll={scroll.onScroll}>{children}</div>
      <footer className="phone-content-footer">
        {error === null ? null : <p className="phone-content-message is-error" role="alert">{error}</p>}
        {message === null ? null : <p className="phone-content-message" role="status">{message}</p>}
        <div className="phone-content-actions">
          {quote === null ? (
            <button type="button" className="primary-button" onClick={() => void copy()}>复制链接到电脑</button>
          ) : <button type="button" className="primary-button" onClick={mention}>在对话里提</button>}
          {quote === null ? null
            : <IconButton icon="link" size={18} label="复制这份内容的链接" onClick={() => void copy()} />}
        </div>
      </footer>
    </div>
  );
}

export function PhoneUnavailable({ route, navigate, onBack }: Omit<PhoneContentProps, 'children'>): ReactNode {
  // 资料库里手机上不能开的是读书（图书馆和空间都能开）。
  const label = route.view === 'books' ? '图书' : navLabel(route.view);
  return (
    <PhoneContent route={route} navigate={navigate} onBack={onBack}>
      <header className="phone-read-title"><Icon name="file" size={24} /><h1>{label}</h1></header>
      <section className="phone-read-section">
        <p className="phone-read-unavailable">{label}暂时不能在手机打开。</p>
      </section>
    </PhoneContent>
  );
}
