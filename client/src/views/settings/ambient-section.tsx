// 设置 · 通用 · 动态背景（11-13 Aaron）：总开关；开着时形象（下拉，海里 / 天上 / 地上 / 赛博各一组）、速度、透明度、
// 显示在哪几页（下拉，多选）。点了马上生效，只在这台设备记住。11-13 看过设计稿后 Aaron 定：选项不平铺，用下拉框选。
// 11-14 设置页一种行（Aaron 弹框选）：右边只放开关、下拉、按钮。11-15 Aaron 弹框定这里是例外、要看得到（设计稿「设置里的
// 两个例外」）：开着时开关下面一条会动的小样，速度和透明度回到滑杆，右边写现在的值。

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ambientSupported } from '../../shell/ambient/ambient-layer.tsx';
import { AmbientEngine } from '../../shell/ambient/engine.ts';
import { AMBIENT_GROUPS, FIGURES, figureById, GROUP_LABELS, type FigureId } from '../../shell/ambient/figures.ts';
import { AMBIENT_PAGE_LABELS, AMBIENT_PAGES, ambientStore, OPACITY_RANGE, saveAmbient, SPEED_RANGE,
  type AmbientSettings } from '../../shell/ambient/settings.ts';
import { DropdownMenu, SEPARATOR, type DropdownEntry } from '../../shell/dropdown-menu.tsx';
import { Icon } from '../../shell/icons.tsx';
import { useStore } from '../../state/use-store.ts';
import { SettingRow, SettingSwitch } from './setting-row.tsx';
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

const speedText = (speed: number): string => `${speed.toFixed(2).replace(/\.?0+$/, '')}×`;
const opacityText = (opacity: number): string => `${Math.round(opacity * 100)}%`;

/** 一根滑杆加右边现在的值：拖着就变、马上记下。 */
function RangeRow({ name, value, range, text, onChange }: { name: string; value: number;
  range: { min: number; max: number; step: number }; text: string; onChange: (value: number) => void }): ReactNode {
  return (
    <SettingRow name={name}>
      <span className="ambient-range">
        <input type="range" aria-label={name} aria-valuetext={text} min={range.min} max={range.max} step={range.step}
          value={value} onChange={(event) => onChange(Number(event.currentTarget.value))} />
        <output>{text}</output>
      </span>
    </SettingRow>
  );
}

/** 小样里的小东西少一点（一条窄的）。 */
const PREVIEW_MOTES = 48;

/** 小样：一条窄的，跟着选的形象、速度、透明度动；鼠标在上面划也会惊动它们。测试环境（没有观察器）不画。 */
function AmbientPreview({ figure, speed, opacity }: { figure: FigureId; speed: number; opacity: number }): ReactNode {
  const canvas = useRef<HTMLCanvasElement>(null);
  const first = useRef({ figure, speed });
  const [engine, setEngine] = useState<AmbientEngine | null>(null);
  useEffect(() => {
    const element = canvas.current;
    if (element === null || !ambientSupported()) return undefined;
    const made = new AmbientEngine(element, { ...first.current, moteCount: PREVIEW_MOTES });
    setEngine(made);
    return () => made.destroy();
  }, []);
  useEffect(() => engine?.setFigure(figure), [engine, figure]);
  useEffect(() => engine?.setSpeed(speed), [engine, speed]);
  return <div className="ambient-preview" aria-hidden="true">
    <canvas ref={canvas} style={{ opacity }} />
  </div>;
}

/** 外观那一组里的「动态背景」一行（设计稿「设置页的布局」），开着时下面缩进几行细项。 */
export function AmbientRows(): ReactNode {
  const settings = useStore(ambientStore);
  const figure = figureById(settings.figure);
  return <>
    <SettingSwitch name="动态背景" tip={TIP} checked={settings.enabled}
      onChange={(enabled) => saveAmbient({ enabled })} />
    {settings.enabled ? <AmbientPreview figure={settings.figure} speed={settings.speed}
      opacity={settings.opacity} /> : null}
    {settings.enabled ? <div className="set-sub ambient-sub">
      <SettingRow name="形象">
        <DropdownMenu label="形象" className="set-select" align="end" items={figureItems(settings.figure)}>
          <span>{`${GROUP_LABELS[figure.group]} · ${figure.label}`}</span><Icon name="chevron-down" size={14} />
        </DropdownMenu>
      </SettingRow>
      <RangeRow name="速度" value={settings.speed} range={SPEED_RANGE} text={speedText(settings.speed)}
        onChange={(speed) => saveAmbient({ speed })} />
      <RangeRow name="透明度" value={settings.opacity} range={OPACITY_RANGE} text={opacityText(settings.opacity)}
        onChange={(opacity) => saveAmbient({ opacity })} />
      <SettingRow name="显示在">
        <DropdownMenu label="显示在" className="set-select" align="end" items={pageItems(settings.pages)}>
          <span>{pagesSummary(settings.pages)}</span><Icon name="chevron-down" size={14} />
        </DropdownMenu>
      </SettingRow>
    </div> : null}
  </>;
}
