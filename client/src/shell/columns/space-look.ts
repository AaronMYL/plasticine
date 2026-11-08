// 空间按来路选图标块（资料库第二栏、资料库首页、⌘K 共用）：研究周报一期是天蓝图表，个人回顾一期是青色星，别的是文件
// （Plasticine 写的天蓝、自己写的鼠尾草绿）。订阅本身同一套（subscriptionLook）。

import type { SpaceListItem, SubscriptionListItem } from '../../api/shared.ts';
import type { HueName } from '../hue.tsx';
import type { IconName } from '../icons.tsx';

export interface Look {
  icon: IconName;
  hue: HueName;
}

export function spaceLook(space: Pick<SpaceListItem, 'kind' | 'author'>): Look {
  if (space.kind === 'research') return { icon: 'chart', hue: 'sky' };
  if (space.kind === 'review') return { icon: 'sparkle', hue: 'teal' };
  return { icon: 'file', hue: space.author === 'ai' ? 'sky' : 'sage' };
}

export function subscriptionLook(kind: SubscriptionListItem['kind']): Look {
  return kind === 'review' ? { icon: 'sparkle', hue: 'teal' } : { icon: 'chart', hue: 'sky' };
}
