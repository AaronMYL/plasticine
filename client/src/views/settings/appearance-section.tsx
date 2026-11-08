import { useState, type ReactNode } from 'react';
import { readAppearance, saveAppearance, type Appearance } from '../../shell/appearance.ts';
import { SectionHead } from './section-head.tsx';

export function AppearanceSection(): ReactNode {
  const [appearance, setAppearance] = useState(readAppearance);
  return <section className="block">
    <SectionHead title="外观" tip="只在这台设备记住。" />
    <select className="field-input settings-appearance" aria-label="外观" value={appearance} onChange={(event) => {
      const value = event.target.value as Appearance;
      saveAppearance(value);
      setAppearance(value);
    }}>
      <option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option>
    </select>
  </section>;
}
