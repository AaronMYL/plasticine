import type { WelcomeStart } from '../../shared/api/account.ts';
import type { LineKernel } from '../lines/index.ts';

export const WELCOME_STARTS: readonly WelcomeStart[] = [
  { id: 'import-notes', label: '导入我的笔记', icon: 'notes',
    prompt: '我想把以前的笔记导进来，你看看怎么导最方便。' },
  { id: 'subscribe-feeds', label: '订几个信息源', icon: 'feed',
    prompt: '帮我订几个信息源吧，先问问我平时爱看什么。' },
  { id: 'get-to-know', label: '先聊聊，认识一下', icon: 'conversation',
    prompt: '我们先聊聊吧，你想先了解我哪些方面？' },
];

export function welcomeText(name: string): string {
  return `你好 ${name}。你说一件事，我能查资料、整理笔记、替你盯着信息流，也能用这台电脑替你动手；`
    + '以你名义对外、花钱、删东西之前，都会先问你。\n\n想从哪儿开始？';
}

export function postWelcome(lines: LineKernel, name: string): void {
  lines.welcome({ text: welcomeText(name), starts: [...WELCOME_STARTS] });
}
