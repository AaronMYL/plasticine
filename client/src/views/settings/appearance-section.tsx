// 外观：主题四套（11-12 全量优化：暖纸、石墨、松林、午夜，每套有浅有深）+ 跟随系统 / 浅色 / 深色。点了马上换，
// 只在这台设备记住。11-14 设置页一种行（Aaron 弹框选，设计稿「设置页的布局」）：「浅色 / 深色」一行下拉；
// 动态背景并进这一组（ambient-section.tsx）。11-15 Aaron 弹框定主题和动态背景是例外、要看得到：主题回到四张小样。

import { useState, type ReactNode } from 'react';
import { PALETTE_ACCENTS, PALETTE_LABELS, PALETTES, readAppearance, readPalette, saveAppearance, savePalette,
  THEME_COLORS, type Appearance, type Palette } from '../../shell/appearance.ts';
import { Icon } from '../../shell/icons.tsx';
import { AmbientRows } from './ambient-section.tsx';
import { SectionHead } from './section-head.tsx';
import { SettingSelect, type SelectOption } from './setting-row.tsx';
import './appearance.css';

const MODES: readonly SelectOption<Appearance>[] = [
  { value: 'system', label: '跟随系统' }, { value: 'light', label: '浅色' }, { value: 'dark', label: '深色' },
];

/** 小样：左半浅底、右半深底，中间一点强调色。颜色从主题表里取（shell/appearance.ts），不在这里写死。 */
function Swatch({ palette }: { palette: Palette }): ReactNode {
  return (
    <span className="settings-palette-swatch" aria-hidden="true">
      <span style={{ background: THEME_COLORS[palette].light }} />
      <span style={{ background: THEME_COLORS[palette].dark }} />
      <i style={{ background: PALETTE_ACCENTS[palette] }} />
    </span>
  );
}

/** 四张小样一排（手机两张一排）；选中的那张描边加粗、名字加重、带勾，不只靠颜色。 */
function PaletteCards({ value, onChange }: { value: Palette; onChange: (palette: Palette) => void }): ReactNode {
  return (
    <div className="settings-palettes" role="group" aria-label="主题">
      {PALETTES.map((palette) => (
        <button key={palette} type="button" className="settings-palette" aria-pressed={palette === value}
          onClick={() => onChange(palette)}>
          <Swatch palette={palette} />
          <span className="settings-palette-name">
            {PALETTE_LABELS[palette]}
            {palette === value ? <Icon name="check" size={14} /> : null}
          </span>
        </button>
      ))}
    </div>
  );
}

export function AppearanceSection(): ReactNode {
  const [appearance, setAppearance] = useState(readAppearance);
  const [palette, setPalette] = useState(readPalette);
  return <section className="block">
    <SectionHead title="外观" tip="只在这台设备记住。" />
    <PaletteCards value={palette} onChange={(value) => {
      savePalette(value);
      setPalette(value);
    }} />
    <SettingSelect name="浅色 / 深色" value={appearance} options={MODES} onChange={(value) => {
      saveAppearance(value);
      setAppearance(value);
    }} />
    <AmbientRows />
  </section>;
}
