// 设置 · 通用 · 动态背景（11-13 Aaron）：总开关；开着时一条小样（跟着选的形象、速度、透明度动）、形象（下拉，海里 / 天上 /
// 地上 / 赛博各一组）、速度和透明度两根滑杆、显示在哪几页（下拉，多选）。点了马上生效，只在这台设备记住。
// 11-13 看过设计稿后 Aaron 定：选项不平铺，用下拉框选。

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ambientSupported } from '../../shell/ambient/ambient-layer.tsx';
import { AmbientEngine } from '../../shell/ambient/engine.ts';
import { AMBIENT_GROUPS, FIGURES, figureById, GROUP_LABELS, type FigureId } from '../../shell/ambient/figures.ts';
import { AMBIENT_PAGE_LABELS, AMBIENT_PAGES, ambientStore, OPACITY_RANGE, saveAmbient, SPEED_RANGE,
  type AmbientSettings } from '../../shell/ambient/settings.ts';
import { DropdownMenu, SEPARATOR, type DropdownEntry } from '../../shell/dropdown-menu.tsx';
import { Icon } from '../../shell/icons.tsx';
import { useStore } from '../../state/use-store.ts';
import { SectionHead } from './section-head.tsx';
import './ambient-section.css';

const TIP = '鼠标划过会惊动它们，点一下会散开；字后面自动压淡，不挡阅读。只在这台设备记住。';

function figureItems(current: FigureId): DropdownEntry[] {
  const entries: DropdownEntry[] = [];
  for (const group of AMBIENT_GROUPS) {
    if (entries.length > 0) entries.push(SEPARATOR);
    for (const figure of FIGURES.filter((one) => one.group === group)) {
      entries.push({ label: figure.label, checked: figure.id === current,
        onSelect: () => saveAmbient({ figure: figure.id }) });
    }
  }
  return entries;
}

function pageItems(pages: AmbientSettings['pages']): DropdownEntry[] {
  return AMBIENT_PAGES.map((page) => ({
    label: AMBIENT_PAGE_LABELS[page], checked: pages[page], keepOpen: true,
    onSelect: () => saveAmbient({ pages: { ...pages, [page]: !pages[page] } }),
  }));
}

/** 下拉按钮上写的：全开写「全部页面」，三页以内写名字，再多写页数。 */
function pagesSummary(pages: AmbientSettings['pages']): string {
  const on = AMBIENT_PAGES.filter((page) => pages[page]);
  if (on.length === AMBIENT_PAGES.length) return '全部页面';
  if (on.length === 0) return '哪页都不显示';
  return on.length <= 3 ? on.map((page) => AMBIENT_PAGE_LABELS[page]).join('、') : `${on.length} 页`;
}

export function AmbientSection(): ReactNode {
  const settings = useStore(ambientStore);
  const figure = figureById(settings.figure);
  return <section className="block" aria-labelledby="settings-ambient">
    <SectionHead id="settings-ambient" title="动态背景" tip={TIP}>
      <input type="checkbox" role="switch" className="ambient-switch" aria-label="动态背景" checked={settings.enabled}
        onChange={(event) => saveAmbient({ enabled: event.currentTarget.checked })} />
    </SectionHead>
    {settings.enabled ? <div className="ambient-settings">
      <AmbientPreview figure={settings.figure} speed={settings.speed} opacity={settings.opacity} />
      <div className="ambient-row">
        <span className="ambient-row-name">形象</span>
        <DropdownMenu label="形象" className="ambient-select" items={figureItems(settings.figure)}>
          {`${GROUP_LABELS[figure.group]} · ${figure.label}`}<Icon name="chevron-down" size={14} />
        </DropdownMenu>
      </div>
      <label className="ambient-row">
        <span className="ambient-row-name">速度</span>
        <input type="range" aria-label="速度" min={SPEED_RANGE.min} max={SPEED_RANGE.max} step={SPEED_RANGE.step}
          value={settings.speed} onChange={(event) => saveAmbient({ speed: Number(event.currentTarget.value) })} />
        <output>{`${settings.speed.toFixed(2).replace(/0$/, '')}×`}</output>
      </label>
      <label className="ambient-row">
        <span className="ambient-row-name">透明度</span>
        <input type="range" aria-label="透明度" min={OPACITY_RANGE.min} max={OPACITY_RANGE.max}
          step={OPACITY_RANGE.step} value={settings.opacity}
          onChange={(event) => saveAmbient({ opacity: Number(event.currentTarget.value) })} />
        <output>{`${Math.round(settings.opacity * 100)}%`}</output>
      </label>
      <div className="ambient-row">
        <span className="ambient-row-name">显示在</span>
        <DropdownMenu label="显示在" className="ambient-select" items={pageItems(settings.pages)}>
          {pagesSummary(settings.pages)}<Icon name="chevron-down" size={14} />
        </DropdownMenu>
      </div>
    </div> : null}
  </section>;
}

/** 小样：一条窄的，跟着选的形象、速度、透明度动；鼠标在上面划也会惊动它们。 */
function AmbientPreview({ figure, speed, opacity }: { figure: FigureId; speed: number; opacity: number }): ReactNode {
  const canvas = useRef<HTMLCanvasElement>(null);
  const first = useRef({ figure, speed });
  const [engine, setEngine] = useState<AmbientEngine | null>(null);
  useEffect(() => {
    const element = canvas.current;
    if (element === null || !ambientSupported()) return undefined;
    const made = new AmbientEngine(element, { ...first.current, moteCount: 48 });
    setEngine(made);
    return () => made.destroy();
  }, []);
  useEffect(() => engine?.setFigure(figure), [engine, figure]);
  useEffect(() => engine?.setSpeed(speed), [engine, speed]);
  return <div className="ambient-preview" aria-hidden="true">
    <canvas ref={canvas} style={{ opacity }} />
  </div>;
}
