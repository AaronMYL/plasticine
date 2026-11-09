// 官网首屏的协作演示（11-09 设计稿）：你 → 你的 AI 拆步骤 → 邀请阿杰和他的 AI → 一起做 → 汇总。写死的数据，不调 AI。
// 看得见时每 3.2 秒自己往下走（页面藏起来、系统设了减少动效、点过步骤就停）；点下面的步骤可以跳。

import { useEffect, useRef, useState, type ReactNode } from 'react';

const STEPS = ['提任务', '拆解', '邀请', '一起做', '汇总'] as const;
const STEP_MS = 3200;

interface Task {
  name: string;
  who: string;
  peer: boolean;
}

const TASKS: readonly Task[] = [
  { name: '对时间', who: '阿杰的 AI', peer: true },
  { name: '订住处', who: '你的 AI', peer: false },
  { name: '排路线', who: '阿杰的 AI', peer: true },
  { name: '记预算', who: '你的 AI', peer: false },
];

export function Spark({ size = 18 }: { size?: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true">
      <path d="M9 1.5v15M1.5 9h15M3.7 3.7l10.6 10.6M14.3 3.7L3.7 14.3" stroke="currentColor" strokeWidth="1.5"
        strokeLinecap="round" fill="none" />
    </svg>
  );
}

export function Check(): ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M2.5 7.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
        strokeLinejoin="round" />
    </svg>
  );
}

function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** 演示自己往下走：只在看得见、页面在前台、没设减少动效、他没手动点过时走。 */
function useAutoplay(length: number): { step: number; go: (index: number) => void; auto: boolean;
  toggle: () => void; ref: React.RefObject<HTMLDivElement | null> } {
  const [step, setStep] = useState(0);
  const [auto, setAuto] = useState(() => !reducedMotion());
  const [visible, setVisible] = useState(true);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (node === null || typeof IntersectionObserver !== 'function') return undefined;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? true));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!auto || !visible) return undefined;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') setStep((current) => (current + 1) % length);
    }, STEP_MS);
    return () => clearInterval(timer);
  }, [auto, visible, length]);
  return { step, auto, ref, go: (index) => {
    setStep(index);
    setAuto(false);
  }, toggle: () => setAuto((value) => !value) };
}

function Graph({ step }: { step: number }): ReactNode {
  const mine = step >= 1;
  const peer = step >= 2;
  return (
    <div className="ch-graph" aria-hidden="true">
      <div className="ch-node" data-on="true"><div className="ch-dot">你</div><span>你</span></div>
      <div className="ch-link" data-on={mine} />
      <div className="ch-node" data-on={mine}><div className="ch-dot ch-dot-ai"><Spark /></div><span>你的 AI</span></div>
      <div className="ch-link ch-link-wide" data-on={peer} />
      <div className="ch-node" data-on={peer} data-dim={!peer}>
        <div className="ch-dot ch-dot-ai ch-dot-peer"><Spark /></div><span>阿杰的 AI</span>
      </div>
      <div className="ch-link" data-on={peer} />
      <div className="ch-node" data-dim={!peer}><div className="ch-dot ch-dot-peer">杰</div><span>阿杰</span></div>
    </div>
  );
}

function TaskList({ running }: { running: boolean }): ReactNode {
  return (
    <ul className="ch-list">
      {TASKS.map((task, index) => (
        <li key={task.name} className="ch-item">
          {running ? (index === 2 ? <span className="ch-spin" role="img" aria-label="在做" />
            : <span style={{ color: 'var(--ch-ok)', display: 'flex' }} role="img" aria-label="做完了"><Check /></span>)
            : null}
          <span>{task.name}</span>
          <span className={task.peer ? 'ch-chip ch-chip-blue' : 'ch-chip'}>{task.who}</span>
        </li>
      ))}
    </ul>
  );
}

function Stage({ step }: { step: number }): ReactNode {
  switch (step) {
    case 0:
      return <>
        <div className="ch-bubble ch-bubble-me ch-rise">这周六去成都玩两天，帮我和阿杰排个行程。</div>
        <div className="ch-meta ch-mono ch-rise-2">你 · 刚刚</div>
      </>;
    case 1:
      return <>
        <div className="ch-bubble ch-bubble-ai ch-rise"><div className="ch-who">你的 AI</div>
          {'拆成四件事。两件交给阿杰那边更合适：他的日程和他熟的路线。'}</div>
        <div className="ch-rise-2"><TaskList running={false} /></div>
      </>;
    case 2:
      return <>
        <div className="ch-bubble ch-bubble-ai ch-rise"><div className="ch-who">你的 AI</div>已向阿杰发出邀请：对时间、排路线。</div>
        <div className="ch-invite ch-rise-2">
          <div className="ch-dot ch-dot-peer">杰</div>
          <div style={{ flex: 1, minWidth: 0 }}><div>阿杰 同意了</div><div className="ch-sub">阿杰的 AI 接下 2 件事</div></div>
          <span className="ch-chip ch-chip-ok">已加入</span>
        </div>
        <div className="ch-bubble ch-bubble-peer ch-rise-3"><div className="ch-who">阿杰的 AI</div>收到。我先看他这周六的安排。</div>
      </>;
    case 3:
      return <>
        <div className="ch-rise"><TaskList running /></div>
        <div className="ch-bubble ch-bubble-peer ch-rise-2"><div className="ch-who">阿杰的 AI</div>他周六上午有事，11 点以后能出发。</div>
        <div className="ch-bubble ch-bubble-ai ch-rise-3"><div className="ch-who">你的 AI</div>那就订 11:30 的高铁，住处换到春熙路附近。</div>
      </>;
    default:
      return <>
        <div className="ch-result ch-rise">
          <div className="ch-result-head"><strong>成都 · 周六到周日</strong><span className="ch-sub ch-mono">4/4 完成</span></div>
          <dl>
            <dt className="ch-mono">周六</dt><dd>11:30 出发 · 下午宽窄巷子 · 晚上玉林路</dd>
            <dt className="ch-mono">住处</dt><dd>春熙路附近，两间</dd>
            <dt className="ch-mono">周日</dt><dd>青城山，傍晚返程</dd>
            <dt className="ch-mono">预算</dt><dd>每人 1,200 元以内</dd>
          </dl>
        </div>
        <div className="ch-row ch-rise-2" style={{ gap: 8 }}>
          <span className="ch-chip">你的 AI · 2 件</span><span className="ch-chip ch-chip-blue">阿杰的 AI · 2 件</span>
          <span className="ch-chip ch-chip-mute">已发给阿杰</span>
        </div>
      </>;
  }
}

export function CollabDemo(): ReactNode {
  const { step, go, auto, toggle, ref } = useAutoplay(STEPS.length);
  return (
    <div id="collab" className="ch-panel" ref={ref} aria-label="协作演示">
      <div className="ch-panel-head">
        <span className="ch-pill ch-mono"><i />演示</span>
        <button type="button" className="ch-act ch-quiet" onClick={toggle}>{auto ? '暂停' : '自动播放'}</button>
      </div>
      <Graph step={step} />
      <div className="ch-stage" aria-live={auto ? 'off' : 'polite'} key={step}><Stage step={step} /></div>
      <div className="ch-steps" role="tablist" aria-label="协作步骤">
        {STEPS.map((label, index) => (
          <button key={label} type="button" role="tab" className="ch-step" aria-selected={index === step}
            aria-label={label} data-done={index < step} onClick={() => go(index)}>
            <span className="ch-mono">{`0${index + 1}`}</span><span className="ch-step-label">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
