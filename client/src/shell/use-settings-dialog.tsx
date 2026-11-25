import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import type { SettingsDialogProps, SettingsRequest } from '../views/settings/settings-dialog.tsx';
import { lazyView } from './lazy-view.ts';
import type { SettingsFocus } from './panel.ts';
import { parseHash, routeHash, type Route, type SettingsSection } from './routes.ts';

const SettingsDialog = lazyView<SettingsDialogProps>(() => import('../views/settings/settings-dialog.tsx'),
  'SettingsDialog');

export interface SettingsDialogHost {
  link: Route | null;
  open: (section?: SettingsSection, focus?: SettingsFocus) => void;
  showing: boolean;
  element: ReactNode;
}

export interface SettingsDialogOptions {
  linked: Route;
  phone: boolean;
  show: (hash: string) => void;
  tabHash: () => string;
  beforeOpen: () => void;
}

function isSettingsHash(hash: string): boolean {
  return parseHash(hash).view === 'settings';
}

export function useSettingsDialog(options: SettingsDialogOptions): SettingsDialogHost {
  const [request, setRequest] = useState<SettingsRequest | null>(null);
  const [leave, setLeave] = useState(0);
  const seq = useRef(0);
  const written = useRef<string | null>(null);
  const wasLink = useRef(false);
  const link = options.linked.view === 'settings' ? options.linked : null;
  const linkHash = link === null ? null : window.location.hash;

  const open = (section: SettingsSection = 'general', focus?: SettingsFocus): void => {
    options.beforeOpen();
    seq.current += 1;
    setRequest({ section, focus, seq: seq.current });
  };
  useEffect(() => {
    if (link === null || linkHash === written.current) {
      return;
    }
    open(link.settingsSection, link.settingsFocus);
  }, [linkHash]);
  const isLink = link !== null;
  useEffect(() => {
    if (request !== null && wasLink.current && !isLink) {
      setLeave((value) => value + 1);
    }
    if (!isLink) {
      written.current = null;
    }
    wasLink.current = isLink;
  }, [isLink, request]);

  const place = (section: SettingsSection): void => {
    const target = routeHash({ view: 'settings', noteId: null, settingsSection: section });
    if (window.location.hash !== target) {
      written.current = target;
      options.show(target);
    }
  };
  const closed = (): void => {
    setRequest(null);
    if (isSettingsHash(window.location.hash)) {
      options.show(options.tabHash());
    }
  };
  const element = request === null ? null : (
    <Suspense fallback={null}>
      <SettingsDialog request={request} leave={leave} phone={options.phone} onPlace={place} onClosed={closed} />
    </Suspense>
  );
  return { link, open, showing: request !== null, element };
}
