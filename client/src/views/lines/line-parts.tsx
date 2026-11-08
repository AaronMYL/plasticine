// 线在对话里的几样小部件（2026-11-05 设计稿 Main / Steps / Waiting）：
//   Spinner   干活中的动态符号（一圈细线 + 一段 --run 弧，转着；减少动态效果时静止）；
//   LiveRow   干活时唯一的一行：动态符号 · 大白话 · 已用时间；
//   StateRow  原位的一行状态：额度暂停（钟）、出错（红叉 + 一句 + 重试）、叫停了；
//   FoldRow   「想了 12 秒 ›」「做了 6 步 ›」：一行安静的开关，点开在原地展开；
//   StepList  展开的步骤：一步一行，图标 · 做了什么 → 结果，左边一根细线串起图标。

import type { ReactNode } from 'react';
import { Icon, type IconName } from '../../shell/icons.tsx';
import type { TurnStep } from './timeline.ts';

export function Spinner({ size = 14, label = '在做' }: { size?: number; label?: string }): ReactNode {
  return (
    <svg className="line-spinner" role="img" aria-label={label} width={size} height={size} viewBox="0 0 16 16"
      fill="none">
      <circle className="line-spinner-track" cx="8" cy="8" r="6" strokeWidth="2" />
      <path className="line-spinner-arc" d="M8 2a6 6 0 0 1 6 6" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function LiveRow({ text, elapsed }: { text: string; elapsed: string | null }): ReactNode {
  return (
    <div className="line-live" role="status">
      <Spinner />
      <span className="line-live-text">{text}</span>
      {elapsed === null ? null : <span className="line-elapsed">{elapsed}</span>}
    </div>
  );
}

export function StateRow({ kind, text, action }: { kind: 'pause' | 'err' | 'stopped'; text: string;
  action?: ReactNode }): ReactNode {
  const icon: IconName = kind === 'err' ? 'close' : kind === 'pause' ? 'clock' : 'pause';
  return (
    <div className="line-state" data-kind={kind} role={kind === 'err' ? 'alert' : 'status'}>
      <span className="line-state-icon" aria-hidden="true"><Icon name={icon} size={kind === 'err' ? 14 : 15} /></span>
      <span className="line-state-text">{text}</span>
      {action === undefined ? null : <><span className="line-state-sep" aria-hidden="true">·</span>{action}</>}
    </div>
  );
}

export function FoldRow({ label, open, onToggle, controls }: { label: string; open: boolean; onToggle: () => void;
  controls?: string }): ReactNode {
  return (
    <button type="button" className="line-fold" aria-expanded={open} aria-controls={controls} onClick={onToggle}>
      {label}
      <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
    </button>
  );
}

/** 步骤的图标：按大白话里的动作和工具名挑（找 / 签名 / 公证 / 权限 / 网页 / 读 / 笔记 / 邮件 / 命令）。 */
export function stepIcon(step: Pick<TurnStep, 'tool' | 'say'>): IconName {
  const { tool, say } = step;
  const rules: ReadonlyArray<[boolean, IconName]> = [
    [say.includes('签名') || say.includes('验证'), 'shield'],
    [say.includes('公证') || say.includes('密码'), 'lock'],
    [say.includes('权限') || say.startsWith('看'), 'eye'],
    [tool.startsWith('cloud_browser') || say.startsWith('搜') || say.includes('网页'), 'globe'],
    [tool.includes('mail') || tool.includes('inbox'), 'mail'],
    [tool.startsWith('note') || tool === 'remember', 'notes'],
    [tool.startsWith('server'), 'terminal'],
    [say.includes('找') || tool.includes('search'), 'search'],
    [say.startsWith('读') || say.includes('读'), 'file'],
    [tool.startsWith('device'), 'device'],
  ];
  return rules.find(([hit]) => hit)?.[1] ?? 'check';
}

export function StepList({ id, steps }: { id?: string; steps: readonly TurnStep[] }): ReactNode {
  return (
    <ol id={id} className="line-steps" aria-label="做了的步骤">
      {steps.map((step) => (
        <li key={step.toolCallId} className="line-step" data-ok={step.ok === false ? 'false' : undefined}>
          <span className="line-step-icon" aria-hidden="true"><Icon name={stepIcon(step)} size={12} /></span>
          <span className="line-step-what">{step.say}</span>
          {step.result === null || step.result === '' ? null : (
            <>
              <span className="line-step-arrow" aria-hidden="true">→</span>
              <span className="line-step-result">{step.ok === false ? `没成：${step.result}` : step.result}</span>
            </>
          )}
        </li>
      ))}
    </ol>
  );
}

export function StopButton({ onStop, busy, large = false }: { onStop: () => void; busy: boolean;
  large?: boolean }): ReactNode {
  return (
    <button type="button" className="line-stop" data-size={large ? 'large' : undefined} aria-label="暂停"
      data-tip="暂停" disabled={busy} onClick={onStop}>
      <Icon name="pause" size={large ? 16 : 14} />
    </button>
  );
}
