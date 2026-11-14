// 外观：主题四套（11-12 全量优化：暖纸、石墨、松林、午夜，每套有浅有深）+ 跟随系统 / 浅色 / 深色。点了马上换，
// 只在这台设备记住。11-14 设置页一种行（Aaron 弹框选，设计稿「设置页的布局」）：两行下拉，取代四张小样和分段控件；
// 动态背景并进这一组（ambient-section.tsx）。

import { useState, type ReactNode } from 'react';
import { PALETTE_LABELS, PALETTES, readAppearance, readPalette, saveAppearance, savePalette,
  type Appearance, type Palette } from '../../shell/appearance.ts';
import { AmbientRows } from './ambient-section.tsx';
import { SectionHead } from './section-head.tsx';
import { SettingSelect, type SelectOption } from './setting-row.tsx';

const MODES: readonly SelectOption<Appearance>[] = [
  { value: 'system', label: '跟随系统' }, { value: 'light', label: '浅色' }, { value: 'dark', label: '深色' },
];
const THEMES: readonly SelectOption<Palette>[] = PALETTES.map((value) => ({ value, label: PALETTE_LABELS[value] }));

export function AppearanceSection(): ReactNode {
  const [appearance, setAppearance] = useState(readAppearance);
  const [palette, setPalette] = useState(readPalette);
  return <section className="block">
    <SectionHead title="外观" tip="只在这台设备记住。" />
    <SettingSelect name="主题" value={palette} options={THEMES} onChange={(value) => {
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
