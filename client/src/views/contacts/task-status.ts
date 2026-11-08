// 跨用户任务卡上怎么说（规格第 9 节）：五段进度 发出 · 点头 · 在做 · 交付 · 验收，每段是做完 / 正在 / 出错 / 还没；
// 一句状态只说现在谁在干什么（「林一的 Plasticine 在做」「等林一验收」），等我表态的那一张不写状态，摆按钮。

import type { NetworkTaskView } from '../../api/shared.ts';

export const TASK_STAGES = ['发出', '点头', '在做', '交付', '收到'] as const;

export type SegmentState = 'done' | 'run' | 'err' | 'off';

const RUNNING_STATES: ReadonlySet<NetworkTaskView['state']> = new Set(['accepted', 'in_progress']);

/** 「在做」那一段的位置：点头了、正在做的时候它亮成 --run（设计稿 Friend-Task-States）。 */
const DOING_INDEX = 2;

export function segments(task: Pick<NetworkTaskView, 'stage' | 'state'>): SegmentState[] {
  const running = RUNNING_STATES.has(task.state) || task.state === 'rejected';
  const done = running ? Math.min(task.stage, DOING_INDEX) : task.stage;
  return TASK_STAGES.map((_, index): SegmentState => {
    if (index < done) {
      return 'done';
    }
    if (index === done && running) {
      return 'run';
    }
    return 'off';
  });
}

export function progressLabel(task: Pick<NetworkTaskView, 'stage' | 'state'>): string {
  const done = TASK_STAGES.slice(0, task.stage);
  return done.length === 0 ? '进度：还没发出' : `进度：${done.join(' · ')}`;
}

/** 卡上那一句（name = 对方的名字）。 */
export function taskStatusLine(task: NetworkTaskView, name: string): string {
  const out = task.direction === 'out';
  switch (task.state) {
    case 'offered':
      return out ? `等${name}点头` : '';
    case 'accepted':
    case 'in_progress':
      if (task.doer === 'ai') {
        return out ? `${name}的 Plasticine 在做` : '你的 Plasticine 在做';
      }
      if (task.doer === 'person') {
        return out ? `${name}在做` : '你来做';
      }
      return out ? `${name}点头了` : '你接了';
    case 'delivered':
      return out ? `${name}交付了` : `等${name}验收`;
    case 'passed':
      return task.verdict?.note ? `收到 · ${task.verdict.note}` : '收到';
    case 'rejected':
      return task.verdict?.note ? `再改改 · ${task.verdict.note}` : '再改改';
    case 'declined':
      return out ? `${name}先不接` : '你先不接';
    case 'cancelled':
      return '取消了';
  }
}

/** 资料栏「交付」一行右边：还在路上的写一个字，结了的写日期（由界面按时区格式化）。 */
export function deliveryWord(state: NetworkTaskView['state']): string | null {
  switch (state) {
    case 'offered':
      return '发出';
    case 'accepted':
    case 'in_progress':
      return '在做';
    case 'delivered':
      return '交付了';
    case 'rejected':
      return '再改改';
    case 'declined':
      return '先不';
    case 'cancelled':
      return '取消';
    case 'passed':
      return null;
  }
}

export function deliveryDot(state: NetworkTaskView['state']): 'run' | 'ok' | 'err' | 'off' {
  if (state === 'passed') {
    return 'ok';
  }
  if (state === 'rejected') {
    return 'err';
  }
  if (state === 'declined' || state === 'cancelled') {
    return 'off';
  }
  return 'run';
}
