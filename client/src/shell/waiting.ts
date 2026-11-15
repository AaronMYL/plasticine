// 「等你 n」：开着的要你定卡（第 28 条：圆球角标；首页「等你」小节的标题）。2026-11-05 任务删了，等你的只剩卡：
// 线出的硬线卡、问他的卡（暂缓的不算）。
// 2026-11-04 第 2 批（用户定「等你的事只在首页列，别处只留一个点」）：侧栏和手机底栏只有「首页」在你不在首页时带一个
// 陶土橙点（点了回首页那一条）；任务、联系人那两个点去掉。对话框圆球照写「等你 n」，在首页上不带数字（小节标题写了）。

import { useLive } from '../live.tsx';
import { useStore } from '../state/use-store.ts';

export function useWaitingCount(): number {
  return useStore(useLive().asks.store).open.length;
}

/** 圆球角标上的数：在首页上不写（首页「等你」小节标题已经写了 n）。 */
export function ballWaiting(waiting: number, onHome: boolean): number {
  return onHome ? 0 : waiting;
}
