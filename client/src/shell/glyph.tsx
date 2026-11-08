// 符号词汇表（2026-11-03《全量界面优化》）：署名、状态、来源权重不再写成字，全站用同一组符号。
// 每个符号都有读屏文字和悬停提示（data-tip，shell/tooltip.tsx），看的人学一次就懂，读屏照旧念全。
//   AiMark      ✦ —— Plasticine 写的 / 推断的 / 提议的；配合 .by-ai 左侧细线用。
//   StatusGlyph 等你（陶土橙实心点）· 在做（状态色点，慢慢一明一暗）· 没开始（空心圈）· 做完（勾）· 暂停（两竖）· 出错（叉，
//               出错是唯一还写字的状态，字由调用方写在旁边）。
//   WeightDot   来源：实心 = 实际结果 · 半实心 = 你说的（他人陈述）· 空心 = Plasticine 写的（推理）。
//               浮框和读屏只说来源，不写权重数（第 5 批用词收尾，11-04 他定）；权重只在代码里当截断顺序用。

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
  // 点了不做事，所以手机上点一下出来源（data-tip-tap，和 ⓘ 一样）。
  return <span className="w-dot" data-w={String(w)} role="img" aria-label={text} data-tip={text} data-tip-tap="" />;
}
