import { useEffect, useRef, type ReactNode } from 'react';
import type { SettingsFocus } from '../../shell/panel.ts';
import type { SettingsSection } from '../../shell/routes.ts';
import { AccountProfile } from './account-profile.tsx';
import { AccessSection } from './access-section.tsx';
import { HardLinesSection } from './hard-lines-section.tsx';
import { NotificationSection } from './notification-section.tsx';
import { AppearanceSection } from './appearance-section.tsx';
import { BrowserSection } from './browser-section.tsx';
import { Devices } from './devices-block.tsx';
import { InstallSection } from './install-section.tsx';
import { ModelsSection } from '../models/models-section.tsx';
import { UsageSection } from '../models/usage-section.tsx';
import { SearchEngineSection } from './search-engine-section.tsx';
import { WebSearchSection } from './web-search-section.tsx';
import { ConnectionsSection } from './connections-section.tsx';
import { SystemSection } from './system-section.tsx';
import { TimeZoneSection } from './time-zone-section.tsx';
import { TranslateSettingsSection } from './translate-settings-section.tsx';
import { VisibilitySection } from './visibility-section.tsx';
import { GRANTS_DOC_ID } from '../../api/shared.ts';
import { MemoryLinkRow } from './memory-link.tsx';
import { SectionHead } from './section-head.tsx';
import './settings.css';
import './network.css';

export const SETTINGS_SECTION_LABELS: Readonly<Record<SettingsSection, string>> = {
  general: '通用',
  account: '账号',
  ai: 'AI',
  grants: '隐私与授权',
  browser: '浏览器',
  system: '系统',
};

const SECTION_CLASS: Partial<Record<SettingsSection, string>> = {
  system: ' settings-system',
  ai: ' settings-ai',
};

function Spot({ name, children }: { name: SettingsFocus; children: ReactNode }): ReactNode {
  return <div className="settings-spot" data-settings-focus={name} tabIndex={-1}>{children}</div>;
}

function Blocks({ section }: { section: SettingsSection }): ReactNode {
  switch (section) {
    case 'general':
      return <>
        <AppearanceSection />
        <Spot name="time-zone"><TimeZoneSection /></Spot>
        <Spot name="notify"><NotificationSection /></Spot>
        <InstallSection />
      </>;
    case 'ai':
      return <>
        <UsageSection />
        <ModelsSection />
        <Spot name="web-search"><WebSearchSection /></Spot>
        <Spot name="connections"><ConnectionsSection /></Spot>
      </>;
    case 'browser':
      return <>
        <SearchEngineSection />
        <BrowserSection />
        <Spot name="translate"><TranslateSettingsSection /></Spot>
      </>;
    case 'account':
      return <>
        <AccountProfile />
        <AccessSection />
        <Devices />
      </>;
    case 'system':
      return <SystemSection />;
    case 'grants':
      return <>
        <HardLinesSection />
        <Spot name="visibility"><VisibilitySection /></Spot>
        <section className="block" aria-label="已经授权的">
          <SectionHead title="已经授权的" />
          <MemoryLinkRow name="对外发送、以后直接做的" topicId={GRANTS_DOC_ID} page="承诺和授权" />
        </section>
      </>;
  }
}

export function SettingsBody({ section, focus }: {
  section: SettingsSection;
  focus?: SettingsFocus | undefined;
}): ReactNode {
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus === undefined || body.current === null) {
      return undefined;
    }
    const root = body.current;
    let focused = false;
    const target = (): boolean => {
      if (!root.isConnected) {
        return false;
      }
      const found = root.querySelector<HTMLElement>(`[data-settings-focus="${focus}"]`);
      if (found === null) {
        return false;
      }
      const group = found.closest('details');
      if (group !== null) {
        group.open = true;
      }
      if (!focused) {
        found.focus({ preventScroll: true });
        focused = true;
      }
      found.scrollIntoView?.({ block: 'start', behavior: 'auto' });
      return true;
    };
    queueMicrotask(target);
    const observer = new MutationObserver(() => target());
    observer.observe(root, { childList: true, subtree: true });
    const pane = root.parentElement ?? root;
    const stop = (): void => observer.disconnect();
    const events = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
    for (const name of events) {
      pane.addEventListener(name, stop, { once: true, passive: true });
    }
    return () => {
      observer.disconnect();
      for (const name of events) {
        pane.removeEventListener(name, stop);
      }
    };
  }, [section, focus]);
  return (
    <div ref={body} className={`settings-content${SECTION_CLASS[section] ?? ''}`}>
      <Blocks section={section} />
    </div>
  );
}
