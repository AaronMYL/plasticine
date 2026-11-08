// 第 102 条第 4 批：iPhone 上写的动作的完成证明。设备保存后按系统给的编号重新读一次（readBack），这里拿读回的
// 那一份和参数比：标题一字不差，时间按同一时刻比（设备回的是另一种写法也算），全天日程只核对是不是全天、是不是那一天。
// 快捷指令只有跑完回到 Plasticine（x-callback 的成功回调）才算做到了；只打开了「快捷指令」不算。

import { Value } from 'typebox/value';
import { IOS_RESULT_SCHEMAS, type DeviceActionParams, type DeviceProof } from '../../shared/api/index.ts';

// 定时日程：同一时刻，留 1 秒给系统存成整秒。
const SAME_INSTANT_MS = 1_000;
// 全天日程：系统按本机时区存成那天零点，和云端写的时刻可以差出一天以内。
const SAME_DAY_MS = 24 * 60 * 60 * 1_000;
// 提醒的到期时间：系统按分钟存。
const SAME_MINUTE_MS = 60 * 1_000;

type EventAction = Extract<DeviceActionParams, { kind: 'calendar_create' }>;
type ReminderAction = Extract<DeviceActionParams, { kind: 'reminder_create' }>;

function close(left: string, right: string, within: number): boolean {
  const a = Date.parse(left);
  const b = Date.parse(right);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < within;
}

export function proveEvent(action: EventAction, result: unknown): DeviceProof {
  const rule = '建日程后按编号读回，标题和时间与参数一致';
  if (!Value.Check(IOS_RESULT_SCHEMAS.calendar_create, result)) {
    return { proven: false, rule, detail: '回执没有按编号读回的日程，不能证明建好了' };
  }
  const back = result.readBack;
  const within = action.allDay ? SAME_DAY_MS : SAME_INSTANT_MS;
  if (back.title !== action.title) {
    return { proven: false, rule, detail: `读回的标题「${back.title}」和要建的「${action.title}」不一样` };
  }
  if (back.allDay !== action.allDay) {
    return { proven: false, rule, detail: action.allDay ? '要建全天日程，读回的不是全天' : '读回的成了全天日程' };
  }
  if (!close(back.start, action.start, within) || !close(back.end, action.end, within)) {
    return { proven: false, rule, detail: `读回的时间 ${back.start} – ${back.end} 和要建的对不上` };
  }
  return { proven: true, rule, detail: `日程 ${result.eventId} 已读回，标题和时间一致` };
}

export function proveReminder(action: ReminderAction, result: unknown): DeviceProof {
  const rule = '建提醒后按编号读回，标题和到期时间与参数一致';
  if (!Value.Check(IOS_RESULT_SCHEMAS.reminder_create, result)) {
    return { proven: false, rule, detail: '回执没有按编号读回的提醒，不能证明建好了' };
  }
  const back = result.readBack;
  if (back.title !== action.title) {
    return { proven: false, rule, detail: `读回的标题「${back.title}」和要建的「${action.title}」不一样` };
  }
  const dueMatches = action.due === null ? back.due === null
    : back.due !== null && close(back.due, action.due, SAME_MINUTE_MS);
  if (!dueMatches) {
    return { proven: false, rule, detail: `读回的到期时间 ${back.due ?? '无'} 和要建的 ${action.due ?? '无'} 对不上` };
  }
  if (back.completed) {
    return { proven: false, rule, detail: '读回的提醒已经是完成状态，不是新建的那一条' };
  }
  return { proven: true, rule, detail: `提醒 ${result.reminderId} 已读回，标题和到期时间一致` };
}

export function proveCompleted(result: unknown): DeviceProof {
  const rule = '标完成后按编号读回，已是完成状态';
  if (!Value.Check(IOS_RESULT_SCHEMAS.reminder_complete, result)) {
    return { proven: false, rule, detail: '回执没有读回的提醒，不能证明标好了' };
  }
  if (!result.readBack.completed) {
    return { proven: false, rule, detail: `读回的「${result.readBack.title}」还没完成` };
  }
  return { proven: true, rule, detail: `读回的「${result.readBack.title}」已完成` };
}

export function proveShortcut(result: unknown): DeviceProof {
  const rule = '快捷指令跑完回到 Plasticine';
  if (!Value.Check(IOS_RESULT_SCHEMAS.shortcut_run, result)) {
    return { proven: false, rule, detail: '回执格式不对，不能证明快捷指令跑完了' };
  }
  if (result.outcome !== 'success') {
    return { proven: false, rule, detail: '只打开了「快捷指令」，没等到它跑完回到 Plasticine，不能证明做到了' };
  }
  return { proven: true, rule, detail: result.output === null ? '快捷指令跑完回到了 Plasticine'
    : '快捷指令跑完回到了 Plasticine，带回了输出' };
}
