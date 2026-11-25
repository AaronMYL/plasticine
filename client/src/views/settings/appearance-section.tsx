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

function Swatch({ palette }: { palette: Palette }): ReactNode {
  return (
    <span className="settings-palette-swatch" aria-hidden="true">
      <span style={{ background: THEME_COLORS[palette].light }} />
      <span style={{ background: THEME_COLORS[palette].dark }} />
      <i style={{ background: PALETTE_ACCENTS[palette] }} />
    </span>
  );
}

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
