// 外观（11-11 页面规范：几个固定选项用分段控件，不用下拉框）：跟随系统 / 浅色 / 深色，只在这台设备记住。

import { useState, type ReactNode } from 'react';
import { readAppearance, saveAppearance, type Appearance } from '../../shell/appearance.ts';
import { SectionHead } from './section-head.tsx';

const OPTIONS: readonly (readonly [Appearance, string])[] = [['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']];

export function AppearanceSection(): ReactNode {
  const [appearance, setAppearance] = useState(readAppearance);
  return <section className="block">
    <SectionHead title="外观" tip="只在这台设备记住。" />
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
