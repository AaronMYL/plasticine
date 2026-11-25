import type { CSSProperties, ReactNode } from 'react';
import { hueVar, type HueName } from '../../shell/hue.tsx';
import './hue-swatches.css';

export interface HueSwatchesProps<H extends HueName> {
  label: string;
  hues: readonly H[];
  names: Readonly<Record<H, string>>;
  value: H;
  onChange: (hue: H) => void;
}

export function HueSwatches<H extends HueName>({ label, hues, names, value, onChange }: HueSwatchesProps<H>):
  ReactNode {
  return (
    <div className="hue-swatches" role="radiogroup" aria-label={label}>
      {hues.map((hue) => (
        <button key={hue} type="button" role="radio" className="hue-swatch" aria-checked={value === hue}
          aria-label={names[hue]} data-tip={names[hue]} onClick={() => onChange(hue)}
          style={{ '--swatch': hueVar(hue) } as CSSProperties} />
      ))}
    </div>
  );
}
