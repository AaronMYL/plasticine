// 网页工具条上的「文A」（2026-11-03 沉浸式翻译，用户定「点了才翻 · 双语对照」）。只在 Mac 0.4.0、iPhone 0.2.0 起的原生桥里出现。
// 点一下开 / 关；开着是按下的样子；右上角的符号（glyph.tsx 词汇表）：在译是慢慢明暗的点，都译完是 ✓，有段落没译成是 ✕、
// 悬停一句原因，这时点按钮是重试没译成的段落（2026-11-04），要关掉在菜单里；付款类页面置灰，悬停说原因。
// 右键或长按出菜单：（开着时）关掉翻译、翻译成、双语对照 / 只看译文、总是翻译这个网站、不翻译这个网站、
// 翻译用的模型（就地换，2026-11-07《优化清单》第 13 条）。
// 菜单盖在原生网页上，标 data-hit-region，点击才归 Plasticine 的页面。

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  siteListed, TRANSLATE_TARGET_LABELS, TRANSLATE_TARGETS, translateSiteOf, type TranslateDisplay,
} from '../api/shared.ts';
import { useLive } from '../live.tsx';
import { useStore } from '../state/use-store.ts';
import { ModelChooserPanel } from '../views/models/model-chooser.tsx';
import { choiceLabel } from '../views/models/model-store.ts';
import { StatusGlyph } from './glyph.tsx';
import { HIT_REGION_ATTRIBUTE } from './hit-regions.ts';
import { Icon } from './icons.tsx';
import { MOTION, play, playThen } from './motion.ts';
import { useDismiss, type DismissReason } from './use-dismiss.ts';
import { useWebTranslator } from './web-translate-context.tsx';
import type { TranslateStatus, WebTranslator } from './web-translate.ts';
import './translate-button.css';

// 触屏按住这么久算长按（和系统长按菜单同档）。
const LONG_PRESS_MS = 500;
const BLOCKED_REASON = '付款类页面不翻译';

const TITLES: Readonly<Record<Exclude<TranslateStatus, 'error'>, string>> = {
  off: '翻译这一页',
  on: '翻译开着，点开换显示方式或关掉',
  running: '正在翻译，点开换显示方式或关掉',
  blocked: BLOCKED_REASON,
};
/** 没拿到具体原因时（页面报有段落没译成，原因已经清掉）的一句。 */
const FAILED_REASON = '有段落没译成。';
const RETRY_HINT = '点一下重试没译成的段落。';
const MENU_ENTER: Keyframe[] = [{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }];
const MENU_LEAVE: Keyframe[] = [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-2px)' }];

/** 按钮右上角的符号：在译一明一暗，都译完是勾，有段落没译成是叉（读屏念原因）；别的状态不画。 */
function StatusDot({ status, reason }: { status: TranslateStatus; reason: string }): ReactNode {
  if (status === 'running') {
    return <span className="translate-dot"><StatusGlyph status="run" label="正在翻译" /></span>;
  }
  if (status === 'on') {
    return <span className="translate-dot"><StatusGlyph status="done" label="已翻译" /></span>;
  }
  if (status === 'error') {
    return <span className="translate-dot"><StatusGlyph status="err" label={reason} /></span>;
  }
  return null;
}

function errorMessage(cause: unknown): void {
  console.warn('翻译设置没存上', cause);
}

/** 翻译用的模型：点开就地换（共用的选模型），换了就是翻译这个功能的默认，设置 · AI 里那一行跟着变。 */
function TranslateModelRow(): ReactNode {
  const live = useLive();
  const data = useStore(live.models.store);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!data.loaded) {
      void live.models.reload();
    }
  }, [data.loaded, live.models]);
  const value = data.value;
  const label = choiceLabel(value, 'translation');
  return (
    <>
      <button type="button" role="menuitem" className="translate-menu-row translate-menu-model" aria-expanded={open}
        onClick={() => setOpen((current) => !current)}>
        <span>模型</span>
        <span className="translate-menu-value">{label ?? '先连接模型'}</span>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} />
      </button>
      {open && value !== null ? (
        <div className="translate-menu-models">
          <ModelChooserPanel value={value} purpose="translation"
            onChoose={(change) => void live.models.choosePurpose('translation', change).then(setError)} />
        </div>
      ) : null}
      {error === null ? null : <p className="translate-menu-error" role="alert">{error}</p>}
    </>
  );
}

function TranslateMenu({ translator, tabId, url, active, onClose }: {
  translator: WebTranslator; tabId: string; url: string; active: boolean; onClose: () => void;
}): ReactNode {
  const settings = useStore(translator.settings);
  const [targets, setTargets] = useState(false);
  const site = translateSiteOf(url);
  const always = settings !== null && siteListed(settings.alwaysSites, url);
  const display = settings?.display ?? 'bilingual';
  const target = settings?.target ?? 'zh-CN';
  const run = (work: Promise<void>, close = true): void => {
    work.catch(errorMessage);
    if (close) {
      onClose();
    }
  };
  const choose = (mode: TranslateDisplay): void => run(translator.setDisplay(mode), false);
  return (
    <div className="translate-menu" role="menu" aria-label="翻译" {...{ [HIT_REGION_ATTRIBUTE]: 'translate-menu' }}>
      {/* 11-13：第一行就是两种显示（切换不重译）；关掉翻译在最下面。 */}
      <div className="segmented translate-menu-display" role="group" aria-label="显示">
        {(['bilingual', 'translation'] as const).map((mode) => (
          <button key={mode} type="button" role="menuitemradio" aria-checked={display === mode}
            aria-pressed={display === mode} className="segmented-item" onClick={() => choose(mode)}>
            {mode === 'bilingual' ? '双语对照' : '只看译文'}
          </button>
        ))}
      </div>
      <button type="button" role="menuitem" className="translate-menu-row" aria-expanded={targets}
        onClick={() => setTargets((open) => !open)}>
        <span>翻译成</span>
        <span className="translate-menu-value">{TRANSLATE_TARGET_LABELS[target]}</span>
        <Icon name={targets ? 'chevron-down' : 'chevron-right'} size={14} />
      </button>
      {targets ? (
        <div className="translate-menu-targets" role="group" aria-label="翻译成">
          {TRANSLATE_TARGETS.map((option) => (
            <button key={option} type="button" role="menuitemradio" aria-checked={option === target}
              className="translate-menu-row" onClick={() => run(translator.setTarget(option))}>
              <span>{TRANSLATE_TARGET_LABELS[option]}</span>
              {option === target ? <Icon name="check" size={14} /> : null}
            </button>
          ))}
        </div>
      ) : null}
      <hr className="translate-menu-line" />
      {site === null ? null : (
        <label className="translate-menu-row">
          <span>总是翻译 {site}</span>
          <input type="checkbox" role="switch" checked={always} aria-label={`总是翻译 ${site}`}
            onChange={(event) => run(translator.setAlways(tabId, url, event.target.checked), false)} />
        </label>
      )}
      {site === null ? null : (
        <button type="button" role="menuitem" className="translate-menu-row"
          onClick={() => run(translator.never(url))}>不翻译这个网站</button>
      )}
      <hr className="translate-menu-line" />
      <TranslateModelRow />
      {active ? <>
        <hr className="translate-menu-line" />
        <button type="button" role="menuitem" className="translate-menu-row" onClick={() => {
          translator.stop(tabId);
          onClose();
        }}>关掉翻译</button>
      </> : null}
    </div>
  );
}

export function TranslateButton({ tabId, url }: { tabId: string; url: string }): ReactNode {
  const translator = useWebTranslator();
  if (translator === null) {
    return null;
  }
  return <TranslateControl translator={translator} tabId={tabId} url={url} />;
}

function TranslateControl({ translator, tabId, url }: { translator: WebTranslator; tabId: string; url: string }):
  ReactNode {
  const tabs = useStore(translator.tabs);
  const state = tabs[tabId] ?? translator.state(tabId);
  const [open, setOpen] = useState(false);
  // 收起的淡出播完才真拿掉。
  const [shown, setShown] = useState(false);
  const openNow = useRef(false);
  openNow.current = open;
  const wrap = useRef<HTMLSpanElement>(null);
  const pop = useRef<HTMLSpanElement>(null);
  const [place, setPlace] = useState<CSSProperties>({});
  const press = useRef<number | null>(null);
  const pressed = useRef(false);
  const menuId = useId();
  const reasonId = useId();
  const placeMenu = (): void => {
    // 菜单挂在 body 上（对话框是悬浮的最上层，主区里的弹层盖不过它），按按钮的位置摆在它右下。
    const button = wrap.current?.getBoundingClientRect();
    if (button !== undefined) {
      setPlace({ top: button.bottom + 8, right: Math.max(8, window.innerWidth - button.right) });
    }
  };
  const focusButton = (): void => {
    wrap.current?.querySelector<HTMLButtonElement>('.translate-button')?.focus({ preventScroll: true });
  };
  const close = (reason?: DismissReason): void => {
    if (reason === 'escape' || pop.current?.contains(document.activeElement) === true) {
      focusButton();
    }
    setOpen(false);
    openNow.current = false;
    playThen(pop.current?.firstElementChild ?? null, MENU_LEAVE, MOTION.fast, () => {
      if (!openNow.current) {
        setShown(false);
      }
    });
  };
  const show = (): void => {
    placeMenu();
    setShown(true);
    setOpen(true);
    openNow.current = true;
  };
  useLayoutEffect(() => {
    if (open) {
      play(pop.current?.firstElementChild ?? null, MENU_ENTER, MOTION.fast);
    }
  }, [open]);
  // 点外面、Esc、点到原生网页（主网页失焦）、切标签、缩放、按钮滚出视野都收（use-dismiss.ts）。
  useDismiss({ open, inside: [wrap, pop], anchor: wrap, onAnchorMove: placeMenu, onDismiss: close });
  const status = state.status;
  const reason = state.reason ?? FAILED_REASON;
  const title = status === 'error' ? `${reason}${RETRY_HINT}` : TITLES[status];
  // 开着时按钮上写进度（11-13 设计稿）：在译 12 / 40 段、译完了、3 段没译成。
  const total = state.done + state.pending + state.failed;
  const progress = status === 'running' ? (total === 0 ? '在译' : `在译 ${state.done} / ${total} 段`)
    : status === 'on' ? '译完了' : status === 'error' ? `${Math.max(state.failed, 1)} 段没译成` : null;
  const cancelPress = (): void => {
    if (press.current !== null) {
      window.clearTimeout(press.current);
      press.current = null;
    }
  };
  return (
    <span className="translate" ref={wrap}>
      <button type="button" className="icon-button translate-button" data-status={status}
        data-text={progress === null ? undefined : 'true'}
        aria-label={status === 'error' ? '重试翻译' : '翻译这一页'}
        aria-pressed={status === 'on' || status === 'running' || status === 'error'}
        aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        aria-describedby={status === 'error' || status === 'blocked' ? reasonId : undefined}
        aria-disabled={status === 'blocked' ? true : undefined} data-tip={title}
        onClick={() => {
          if (pressed.current || status === 'blocked') {
            pressed.current = false;
            return;
          }
          if (open) {
            close();
            if (status !== 'error') { return; }
          }
          if (status === 'error') {
            translator.retry(tabId);
          } else if (status === 'off') {
            translator.toggle(tabId, url);
          } else if (!open) {
            // 开着时点一下是出菜单（换显示方式、关掉），不直接关——关掉在菜单最下面。
            show();
          }
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          if (open) {
            close();
          } else {
            show();
          }
        }}
        onPointerDown={(event) => {
          if (event.pointerType !== 'touch') {
            return;
          }
          cancelPress();
          press.current = window.setTimeout(() => {
            press.current = null;
            pressed.current = true;
            show();
          }, LONG_PRESS_MS);
        }}
        onPointerUp={cancelPress} onPointerLeave={cancelPress}>
        <Icon name="translate" size={16} />
        <StatusDot status={status} reason={reason} />
        {progress === null ? null : <span className="translate-progress">{progress}</span>}
      </button>
      {status === 'error' || status === 'blocked' ? <span id={reasonId} className="sr-only">{title}</span> : null}
      {shown ? createPortal(<span id={menuId} ref={pop} className="translate-pop" style={place}
        data-leaving={open ? undefined : 'true'}>
        <TranslateMenu translator={translator} tabId={tabId} url={url}
          active={status === 'on' || status === 'running' || status === 'error'} onClose={() => close()} />
      </span>, document.body) : null}
    </span>
  );
}
