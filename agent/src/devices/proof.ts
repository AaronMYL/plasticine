// 第 102 条：设备动作的完成标准由回执证明——设备回执才算数，「我点了」不算。截图核对的执行在设备（Swift）侧，
// 这里定判定：写文件回读版本与写入内容一致；点击 / 输入之后设备再截一张，画面有变化。
// 网页标签（第 3 批）按 DOM 读回：开 / 换地址读回页面载入完成和最终地址；点之后读回页面（地址、标题、正文和被点元素
// 的状态）有变化；填之后读回框里的值和要填的一致。其余动作的回执本身就是结果。
// iPhone（第 4 批）：建日程、建提醒、标完成按编号从系统里读回来核对（ios-proof.ts）；快捷指令要跑完回到 App 的回执。

import { createHash } from 'node:crypto';
import { Value } from 'typebox/value';
import { DeviceAfterShotSchema, type DeviceActionParams, type DeviceProof } from '../../shared/api/index.ts';
import { proveCompleted, proveEvent, proveReminder, proveShortcut } from './ios-proof.ts';

const VERSION_SHOWN_CHARS = 12;

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function field(result: unknown, name: string): unknown {
  return typeof result === 'object' && result !== null ? Reflect.get(result, name) : undefined;
}

function short(version: string): string {
  return `${version.slice(0, VERSION_SHOWN_CHARS)}…`;
}

function proveWrite(content: string, result: unknown): DeviceProof {
  const rule = '写文件回读版本与写入内容一致';
  const version = field(result, 'version');
  const expected = sha256(content);
  if (typeof version !== 'string') {
    return { proven: false, rule, detail: '回执没有回读版本，不能证明写对了' };
  }
  if (version !== expected) {
    return { proven: false, rule, detail: `回读版本 ${short(version)} 和写入内容的版本 ${short(expected)} 不一致` };
  }
  return { proven: true, rule, detail: `回读版本 ${short(version)} 与写入内容一致` };
}

function proveInput(result: unknown): DeviceProof {
  const rule = '动作之后设备再截一张，画面有变化';
  const shot = field(result, 'afterShot');
  if (!Value.Check(DeviceAfterShotSchema, shot)) {
    return { proven: false, rule, detail: '设备没有回传动作之后的截图，不能证明点到了' };
  }
  const reported = field(result, 'changed');
  const changed = typeof reported === 'boolean' ? reported
    : shot.beforeSha256 === undefined ? undefined : shot.beforeSha256 !== shot.sha256;
  if (changed === undefined) {
    return { proven: false, rule, detail: '设备回传了截图，但没说画面有没有变化，不能证明点到了' };
  }
  if (!changed) {
    return { proven: false, rule, detail: '动作之后画面没有变化，不能证明点到了' };
  }
  return { proven: true, rule, detail: `动作之后的截图 ${shot.width}×${shot.height}（${shot.capturedAt}）画面有变化` };
}

function provePage(result: unknown): DeviceProof {
  const rule = '读回网页标签：页面载入完成';
  const url = field(result, 'url');
  if (field(result, 'loaded') !== true || typeof url !== 'string' || url === '') {
    return { proven: false, rule, detail: '设备没有读回载入完成的页面，不能证明打开了' };
  }
  return { proven: true, rule, detail: `页面已载入：${url}` };
}

function proveTabClick(result: unknown): DeviceProof {
  const rule = '点之后读回页面，地址、标题、正文或被点元素的状态有变化';
  const before = field(result, 'before');
  const after = field(result, 'after');
  const changed = field(result, 'changed');
  if (typeof changed !== 'boolean' || field(before, 'digest') === undefined || field(after, 'digest') === undefined) {
    return { proven: false, rule, detail: '设备没有读回点之前和之后的页面，不能证明点到了' };
  }
  if (!changed) {
    return { proven: false, rule, detail: '点之后页面没有变化，不能证明点到了' };
  }
  const url = field(after, 'url');
  return { proven: true, rule, detail: `点之后页面有变化${typeof url === 'string' ? `（现在在 ${url}）` : ''}` };
}

function proveTabFill(result: unknown): DeviceProof {
  const rule = '填完读回框里的值，和要填的一致';
  if (field(result, 'matches') !== true) {
    return { proven: false, rule, detail: '读回的值和要填的不一致，不能证明填对了' };
  }
  return { proven: true, rule, detail: '读回框里的值和要填的一致' };
}

/** tab_act：填、选读回一致；点、回车之后页面变了；翻页滚动本身就是结果。 */
function proveTabAct(action: Extract<DeviceActionParams, { kind: 'tab_act' }>, result: unknown): DeviceProof {
  switch (action.act.op) {
    case 'fill':
    case 'select':
      return field(result, 'matches') === true
        ? { proven: true, rule: '填完读回框里的值，和要填的一致', detail: '读回框里的值和要填的一致' }
        : { proven: false, rule: '填完读回框里的值，和要填的一致', detail: '读回的值和要填的不一致，不能证明填对了' };
    case 'click':
    case 'enter':
      return proveTabClick(result);
    case 'scroll':
      return { proven: true, rule: '设备回执', detail: '翻页的回执就是结果（带着翻完的页面）' };
  }
}

/** Whether the device's receipt proves the action did what its parameters asked. */
export function proveDeviceAction(action: DeviceActionParams, result: unknown): DeviceProof {
  switch (action.kind) {
    case 'file_write':
      return proveWrite(action.content, result);
    case 'input_click':
    case 'input_type':
      return proveInput(result);
    case 'tab_open':
    case 'tab_navigate':
      return provePage(result);
    case 'tab_click':
      return proveTabClick(result);
    case 'tab_fill':
      return proveTabFill(result);
    case 'tab_act':
      return proveTabAct(action, result);
    case 'calendar_create':
      return proveEvent(action, result);
    case 'reminder_create':
      return proveReminder(action, result);
    case 'reminder_complete':
      return proveCompleted(result);
    case 'shortcut_run':
      return proveShortcut(result);
    default:
      return { proven: true, rule: '设备回执', detail: '设备的回执就是这个动作的结果' };
  }
}
