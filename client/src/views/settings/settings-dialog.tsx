import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '../../shell/icons.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { MOTION, play, playThen } from '../../shell/motion.ts';
import type { SettingsFocus } from '../../shell/panel.ts';
import { SETTINGS_SECTIONS, type SettingsSection } from '../../shell/routes.ts';
import { SETTINGS_SECTION_LABELS, SettingsBody } from './settings-body.tsx';
import { SettingsDrafts, SettingsDraftsContext, SettingsGoContext } from './settings-dialog-context.ts';
import { useDialogFocus } from './settings-dialog-focus.ts';
import { searchSettings } from './settings-index.ts';
import '../../shell/dialog.css';
import './settings-dialog.css';
import { SearchField } from '../../primitives/search-field/index.tsx';

const FOUND_FLASH_MS = 1_600;

const SECTION_ICONS: Readonly<Record<SettingsSection, IconName>> = {
  general: 'settings',
  ai: 'sparkle',
  browser: 'globe',
  account: 'person',
  grants: 'lock',
  system: 'device',
};

export interface SettingsRequest {
  section: SettingsSection;
  focus?: SettingsFocus | undefined;
  seq: number;
}

export interface SettingsDialogProps {
  request: SettingsRequest;
  leave: number;
  phone: boolean;
  onPlace: (section: SettingsSection) => void;
  onClosed: () => void;
}

interface Place {
  section: SettingsSection;
  focus?: SettingsFocus | undefined;
}

type Leaving = { kind: 'close' } | ({ kind: 'go' } & Place);

const PANEL_ENTER: Keyframe[] = [
  { opacity: 0, transform: 'translateY(6px) scale(0.98)' },
  { opacity: 1, transform: 'translateY(0) scale(1)' },
];
const SHEET_ENTER: Keyframe[] = [
  { opacity: 0, transform: 'translateY(24px)' },
  { opacity: 1, transform: 'translateY(0)' },
];
const FADE_IN: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];
const FADE_OUT: Keyframe[] = [{ opacity: 1 }, { opacity: 0 }];

function reversed(frames: Keyframe[]): Keyframe[] {
  return [...frames].reverse();
}

function UnsavedAsk({ onKeep, onDiscard }: { onKeep: () => void; onDiscard: () => void }): ReactNode {
  const id = useId();
  const keep = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    keep.current?.focus({ focusVisible: false });
  }, []);
  return (
    <div className="dialog-layer settings-ask-layer">
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby={id}>
        <h3 id={id} className="dialog-title">有没保存的修改</h3>
        <div className="dialog-actions">
          <button type="button" className="secondary-button settings-ask-discard" onClick={onDiscard}>放弃修改</button>
          <button ref={keep} type="button" className="primary-button" onClick={onKeep}>继续编辑</button>
        </div>
      </div>
    </div>
  );
}

export function SettingsDialog({ request, leave, phone, onPlace, onClosed }: SettingsDialogProps): ReactNode {
  const titleId = useId();
  const [place, setPlace] = useState<Place>({ section: request.section, focus: request.focus });
  const [leaving, setLeaving] = useState<Leaving | null>(null);
  const drafts = useMemo(() => new SettingsDrafts(), []);
  const panel = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const pane = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  const firstSeq = useRef(request.seq);
  const firstLeave = useRef(leave);

  const finish = (): void => {
    if (closing.current) {
      return;
    }
    closing.current = true;
    panel.current?.setAttribute('data-closing', 'true');
    scrim.current?.setAttribute('data-closing', 'true');
    play(scrim.current, FADE_OUT, MOTION.fast);
    playThen(panel.current, reversed(phone ? SHEET_ENTER : PANEL_ENTER), MOTION.fast, onClosed);
  };
  const run = (next: Leaving): void => {
    setLeaving(null);
    if (next.kind === 'close') {
      finish();
      return;
    }
    setPlace({ section: next.section, focus: next.focus });
  };
  const attempt = (next: Leaving): void => {
    if (next.kind === 'go' && next.section === place.section && next.focus === place.focus) {
      return;
    }
    if (drafts.dirty()) {
      setLeaving(next);
      return;
    }
    run(next);
  };
  const go = (section: SettingsSection, focus?: SettingsFocus): void => attempt({ kind: 'go', section, focus });
  const requestClose = (): void => {
    if (leaving !== null) {
      setLeaving(null);
      return;
    }
    attempt({ kind: 'close' });
  };

  useDialogFocus(panel, requestClose);
  useLayoutEffect(() => {
    play(scrim.current, FADE_IN, MOTION.base);
    play(panel.current, phone ? SHEET_ENTER : PANEL_ENTER, MOTION.base);
  }, []);
  useEffect(() => {
    if (request.seq !== firstSeq.current) {
      go(request.section, request.focus);
    }
  }, [request.seq]);
  useEffect(() => {
    if (leave !== firstLeave.current) {
      attempt({ kind: 'close' });
    }
  }, [leave]);
  useLayoutEffect(() => {
    onPlace(place.section);
    const element = pane.current;
    if (element === null) {
      return;
    }
    element.scrollTop = 0;
    play(element.firstElementChild, FADE_IN, MOTION.fast);
  }, [place.section]);

  const [query, setQuery] = useState('');
  const [jump, setJump] = useState<{ section: SettingsSection; title: string } | null>(null);
  const found = searchSettings(query);
  useEffect(() => {
    if (jump === null || jump.section !== place.section) {
      return undefined;
    }
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const locate = (): void => {
      const heading = [...(pane.current?.querySelectorAll<HTMLElement>('h2, h3') ?? [])]
        .find((element) => element.textContent?.trim() === jump.title);
      const block = heading?.closest<HTMLElement>('section, .block') ?? heading;
      if (block !== undefined && block !== null) {
        block.scrollIntoView?.({ block: 'start', behavior: 'auto' });
        block.setAttribute('data-found', 'true');
        timer = setTimeout(() => block.removeAttribute('data-found'), FOUND_FLASH_MS);
        setJump(null);
      } else if ((tries += 1) < 10) {
        timer = setTimeout(locate, 100);
      } else {
        setJump(null);
      }
    };
    locate();
    return () => clearTimeout(timer);
  }, [jump, place.section]);

  const label = SETTINGS_SECTION_LABELS[place.section];
  return (
    <SettingsDraftsContext.Provider value={drafts}>
      <SettingsGoContext.Provider value={go}>
        <div ref={scrim} className="settings-scrim" data-testid="settings-scrim" aria-hidden="true"
          onClick={requestClose} />
        <div ref={panel} className="settings-dialog" data-phone={phone} role="dialog" aria-modal="true"
          aria-labelledby={titleId} tabIndex={-1}>
          <nav className="settings-dialog-nav" aria-label="设置分类" inert={leaving !== null}>
            <h2 id={titleId} className="settings-dialog-title">设置</h2>
            <SearchField className="settings-search" label="搜设置" value={query} onChange={setQuery} />
            {query.trim() === '' ? null : (
              <ul className="settings-dialog-sections settings-search-results" aria-label="找到的设置">
                {found.length === 0 ? <li className="settings-search-empty">没有对得上的设置</li> : null}
                {found.map((entry) => (
                  <li key={`${entry.section}:${entry.title}`}>
                    <button type="button" className="settings-nav-item settings-search-item" onClick={() => {
                      setQuery('');
                      setJump({ section: entry.section, title: entry.title });
                      go(entry.section);
                    }}>
                      <Icon name={SECTION_ICONS[entry.section]} />
                      <span>{entry.title}</span>
                      <span className="settings-search-where">{SETTINGS_SECTION_LABELS[entry.section]}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {query.trim() !== '' ? null : (
              <ul className="settings-dialog-sections">
                {SETTINGS_SECTIONS.map((section) => (
                  <li key={section}>
                    <button type="button" className="settings-nav-item"
                      aria-current={place.section === section ? 'page' : undefined}
                      onClick={() => go(section)}>
                      <Icon name={SECTION_ICONS[section]} />
                      <span>{SETTINGS_SECTION_LABELS[section]}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </nav>
          <section className="settings-dialog-main" aria-label={label} inert={leaving !== null}>
            <header className="settings-dialog-head">
              <h2 className="settings-dialog-section">{label}</h2>
              <IconButton icon="close" className="settings-dialog-close" label="关掉设置" onClick={requestClose} />
            </header>
            <div ref={pane} className="settings-dialog-pane">
              <SettingsBody key={place.section} section={place.section} focus={place.focus} />
            </div>
          </section>
          {leaving === null ? null : (
            <UnsavedAsk onKeep={() => setLeaving(null)} onDiscard={() => {
              drafts.discard();
              run(leaving);
            }} />
          )}
        </div>
      </SettingsGoContext.Provider>
    </SettingsDraftsContext.Provider>
  );
}
