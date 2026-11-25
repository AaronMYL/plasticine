import type { AskPurpose, Channel } from '../../shared/state.ts';

export type AskChannel = Exclude<Channel, 'silent'>;

export function channelForAsk(_purpose: AskPurpose, requested: AskChannel | undefined): AskChannel {
  return requested ?? 'popup';
}

export function showsCard(channel: Channel): boolean {
  return channel === 'popup' || channel === 'interrupt';
}

/** Whether a channel also sends a system notification to the user's devices. */
export function pushes(channel: Channel): boolean {
  return channel === 'interrupt';
}

