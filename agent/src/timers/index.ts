// timers/：线的「回来看」和「盯着」（11-16 能力总表）。line_wake_later 到点叫醒这条线，watch_start 隔一段时间看一处、
// 变了叫醒它；他在任务的「在做」里看得到、能关。存在 state/ 的 lineTimers（迁移 0145）。

export { addedLines, LineTimers, WATCH_MIN_MINUTES, watchText } from './line-timers.ts';
export type { LineTimerDeps } from './line-timers.ts';
