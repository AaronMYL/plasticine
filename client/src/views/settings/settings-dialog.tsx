// 设置弹框（2026-11-05 他定：设置从标签页改成居中弹框）。电脑上居中约 880×640（窗口小时跟着收），--layer-float 底 +
// --lift，背后 --scrim 盖住整个窗口；左边五段，右边这一段的内容自己滚；右上角关。Esc、点蒙层也关。焦点困在弹框里，
// 关了回到打开它的地方。手机上是全屏的一张，分段是顶上一排。
// 段里有没保存的修改（settings-dialog-context.ts 的登记处）时，关、切段之前先在弹框里问一句：「继续编辑」/「放弃修改」。
// 出现淡入、略放大到位（--motion-base），收起更快（--motion-fast）；减少动态效果时即时（motion.ts）。

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
import './settings-dialog.css';

/** 查找跳到的那一块闪多久。 */
const FOUND_FLASH_MS = 1_600;

const SECTION_ICONS: Readonly<Record<SettingsSection, IconName>> = {
  general: 'settings',
  ai: 'sparkle',
  browser: 'globe',
  account: 'person',
  grants: 'lock',
  system: 'device',
};

/** 打开设置的那一下：开在哪一段、哪一处；seq 每次打开 / 从外面再跳一次都加一（弹框开着时也能换段）。 */
export interface SettingsRequest {
  section: SettingsSection;
  focus?: SettingsFocus | undefined;
  seq: number;
}

export interface SettingsDialogProps {
  request: SettingsRequest;
  /** 壳每要弹框收起一次（开着时走到了别的地址）就加一：照关弹框的规矩走（有没保存的修改先问）。 */
  leave: number;
  phone: boolean;
  /** 现在开在哪一段（打开时、换段时都报）：壳把地址写成 #/settings/<段>，刷新后照样开在这里。 */
  onPlace: (section: SettingsSection) => void;
  /** 收起动画播完了：壳把弹框拿掉。 */
  onClosed: () => void;
}

interface Place {
  section: SettingsSection;
  focus?: SettingsFocus | undefined;
}

/** 等「继续编辑 / 放弃修改」的那一步：关掉，或者去另一段。 */
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
  const box = useRef<HTMLDivElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    // 焦点给「继续编辑」（回车就是继续编辑）；鼠标点出来的不画焦点环，键盘 Tab 起来照常有。
    keep.current?.focus({ focusVisible: false });
    play(box.current, PANEL_ENTER, MOTION.fast);
  }, []);
  return (
    <div className="settings-ask-layer">
      <div ref={box} className="settings-ask" role="alertdialog" aria-modal="true" aria-labelledby={id}>
        <h3 id={id} className="settings-ask-title">有没保存的修改</h3>
        <div className="settings-ask-actions">
          <button type="button" className="chip-button settings-ask-discard" onClick={onDiscard}>放弃修改</button>
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
    // 只在打开时播一次；phone 中途变了（窗口拖窄）不重播。
  }, []);
  // 弹框开着时又从别处要了一段（比如登录导入回来到「浏览器与信息流」）：照切段的规矩走。
  useEffect(() => {
    if (request.seq !== firstSeq.current) {
      go(request.section, request.focus);
    }
    // 只认新的一次请求（go 每次渲染都是新的，不进依赖）。
  }, [request.seq]);
  useEffect(() => {
    if (leave !== firstLeave.current) {
      attempt({ kind: 'close' });
    }
  }, [leave]);
  // 换段：内容从顶上开始，淡入；地址跟着换。
  useLayoutEffect(() => {
    onPlace(place.section);
    const element = pane.current;
    if (element === null) {
      return;
    }
    element.scrollTop = 0;
    play(element.firstElementChild, FADE_IN, MOTION.fast);
  }, [place.section]);

  // 查找（settings-index.ts）：点一条去那一段，再滚到那一块并闪一下。
  const [query, setQuery] = useState('');
  const [jump, setJump] = useState<{ section: SettingsSection; title: string } | null>(null);
  const found = searchSettings(query);
  useEffect(() => {
    if (jump === null || jump.section !== place.section) {
      return undefined;
    }
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // 那一段的内容有的要读一下才出来：最多等一秒。
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
            <label className="settings-search">
              <Icon name="search" size={14} />
              <input type="search" aria-label="搜设置" placeholder="搜设置" value={query}
                onChange={(event) => setQuery(event.target.value)} />
            </label>
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
