// 外观（11-11 页面规范：几个固定选项用分段控件，不用下拉框）：主题四套（11-12 全量优化：暖纸、石墨、松林、午夜，
// 每套有浅有深）+ 跟随系统 / 浅色 / 深色。点了马上换，只在这台设备记住。

import { useState, type ReactNode } from 'react';
import { PALETTE_ACCENTS, PALETTE_LABELS, PALETTES, readAppearance, readPalette, saveAppearance, savePalette,
  THEME_COLORS, type Appearance, type Palette } from '../../shell/appearance.ts';
import { SectionHead } from './section-head.tsx';
import './appearance.css';

const OPTIONS: readonly (readonly [Appearance, string])[] = [['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']];

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

export function AppearanceSection(): ReactNode {
  const [appearance, setAppearance] = useState(readAppearance);
  const [palette, setPalette] = useState(readPalette);
  return <section className="block">
    <SectionHead title="外观" tip="只在这台设备记住。" />
    <div className="settings-palettes" role="group" aria-label="主题">
      {PALETTES.map((value) => (
        <button key={value} type="button" className="settings-palette" aria-pressed={palette === value}
          onClick={() => {
            savePalette(value);
            setPalette(value);
          }}>
          <Swatch palette={value} />
          {PALETTE_LABELS[value]}
        </button>
      ))}
    </div>
    <div className="segmented settings-appearance" role="group" aria-label="外观">
      {OPTIONS.map(([value, label]) => (
        <button key={value} type="button" className="segmented-item" aria-pressed={appearance === value}
          onClick={() => {
            saveAppearance(value);
            setAppearance(value);
          }}>{label}</button>
      ))}
    </div>
  </section>;
}
