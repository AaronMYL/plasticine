import type { ReactNode } from 'react';
import { Icon } from './icons.tsx';
import './glyph.css';

export function AiMark({ label = 'Plasticine 写的' }: { label?: string }): ReactNode {
  return (
    <span className="ai-mark" role="img" aria-label={label} data-tip={label}>
      <Icon name="sparkle" size={12} />
    </span>
  );
}

export type GlyphStatus = 'wait' | 'run' | 'idle' | 'done' | 'pause' | 'err';

const GLYPH_TEXT: Readonly<Record<GlyphStatus, string>> = {
  wait: '等你',
  run: '在做',
  idle: '没开始',
  done: '做完',
  pause: '暂停',
  err: '出错',
};

export function StatusGlyph({ status, label }: { status: GlyphStatus; label?: string }): ReactNode {
  const text = label ?? GLYPH_TEXT[status];
  return <span className="glyph" data-status={status} role="img" aria-label={text} data-tip={text} />;
}

export type Weight = 1 | 0.5 | 0.1;

const WEIGHT_TEXT: Readonly<Record<string, string>> = {
  '1': '实际结果',
  '0.5': '你说的',
  '0.1': 'Plasticine 写的',
};

export function WeightDot({ w, label }: { w: Weight; label?: string }): ReactNode {
  const text = label ?? WEIGHT_TEXT[String(w)] ?? '';
  return <span className="w-dot" data-w={String(w)} role="img" aria-label={text} data-tip={text} data-tip-tap="" />;
}
