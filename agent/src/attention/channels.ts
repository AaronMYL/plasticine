// 四档渠道（《从零方案》第 6 节，第 91 条 ⑤）：渠道定的是打扰的下限。
// - 不打扰：只留在记录和清单里，不出卡。（2026-11-06 他定《优化清单》第 12 条：主线上的通知——后台线做完、项目逾期、
//   磁盘不够——一律是主线一条消息 + 系统通知，走 notices.ts，不按这四档；任何通知都不再发邮件。）
// - 下次汇报：卡挂在「等你」区最后，不摊开、不推送（采访这类）。
// - 弹框：对话流里的一张卡，一次只摊开一张（《UI 方案》第 6 节）。
// - 立刻打断：弹框，再加一条浏览器系统通知（Web Push，只有一句话和链接）。
// 没有每天配额（第一阶段只采数，《从零方案》第 6 节）。

import type { AskPurpose, Channel } from '../../shared/state.ts';

/** What a card may ask for itself; 不打扰 is not one of them — a card nobody sees is a card nobody answers. */
export type AskChannel = Exclude<Channel, 'silent'>;

/** The channel a card gets: the requester's choice (立刻打断 only for something time-bound), popup by default. */
export function channelForAsk(_purpose: AskPurpose, requested: AskChannel | undefined): AskChannel {
  return requested ?? 'popup';
}

/** Whether a channel spreads the card open in the conversation (the others wait in 等你). */
export function showsCard(channel: Channel): boolean {
  return channel === 'popup' || channel === 'interrupt';
}

/** Whether a channel also sends a system notification to the user's devices. */
export function pushes(channel: Channel): boolean {
  return channel === 'interrupt';
}


