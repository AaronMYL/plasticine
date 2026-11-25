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

function pagesSummary(pages: AmbientSettings['pages']): string {
  const on = AMBIENT_PAGES.filter((page) => pages[page]);
  if (on.length === AMBIENT_PAGES.length) return '全部页面';
  if (on.length === 0) return '哪页都不显示';
  return on.length <= 3 ? on.map((page) => AMBIENT_PAGE_LABELS[page]).join('、') : `${on.length} 页`;
}

const speedText = (speed: number): string => `${speed.toFixed(2).replace(/\.?0+$/, '')}×`;
const opacityText = (opacity: number): string => `${Math.round(opacity * 100)}%`;

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

const PREVIEW_MOTES = 48;

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
