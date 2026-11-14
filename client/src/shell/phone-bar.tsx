// 手机底栏（11-07 定，设计稿 Phone-Now / Phone-More）：现在 · Plasticine · 消息 · 笔记 · 更多，--layer-side 底、顶部
// 1px --line，平铺不是胶囊。任务、信息流、图书、空间在「更多」的底部抽屉里（四格类别色图标块），下面一行设置；有事等他时
// 「更多」和抽屉里的「任务」带一个陶土点。点开的那一条（读书、聊天、邮件、资料）整屏给那一页，不画底栏。

import type { ReactNode } from 'react';
import { Sheet } from '../primitives/sheet/index.tsx';
import { HueTile } from './hue.tsx';
import { Icon } from './icons.tsx';
import { PlasticineMark } from './plasticine-mark.tsx';
import { MainAvatar } from '../views/mates/mate-avatar.tsx';
import type { Route } from './routes.ts';
import { MORE_ITEMS, PHONE_TABS, SECTIONS, phoneTabOf, type MoreItemId, type PhoneTabId } from './sections.ts';

export interface PhoneBarProps {
  route: Route;
  hidden?: boolean;
  waiting?: number;
  onTab: (tab: PhoneTabId) => void;
}

/**
 * 手机上整屏给这一页、不画底栏：读书、打开的报告和来信（第 8 批第 6 条，设计稿 Phone-Report / Phone-Letter：只有返回）、
 * 消息里点开的那一条、工作详情、项目和记忆的只读详情。
 */
export function phoneFullPage(route: Route): boolean {
  if (route.view === 'plasticine' && (route.plasticineMain === true
    || route.mateId != null
    || route.mateGroupId != null || route.lineId != null || route.messageId != null)) return true;
  if (route.view === 'projects' || route.view === 'memory' || route.view === 'work' || route.view === 'skills') return true;
  if (route.view === 'books' && (route.bookId != null || route.spaceId != null)) {
    return true;
  }
  return route.view === 'messages' && (route.contactId != null || route.contactPane === 'requests');
}

const LABELS: Readonly<Record<PhoneTabId, string>> = {
  now: SECTIONS.now.label, plasticine: SECTIONS.plasticine.label, messages: SECTIONS.messages.label,
  notes: SECTIONS.notes.label, more: '更多',
};

function TabIcon({ tab }: { tab: PhoneTabId }): ReactNode {
  // 第13批：底栏的 Plasticine 是主线的头像，跟着主线在做什么动。
  if (tab === 'plasticine') return <MainAvatar size={26} />;
  if (tab === 'more') return <Icon name="more" size={22} />;
  const icon = SECTIONS[tab].icon;
  return icon === 'mark' ? <PlasticineMark size={22} /> : <Icon name={icon} size={22} />;
}

export function PhoneBar({ route, hidden = false, waiting = 0, onTab }: PhoneBarProps): ReactNode {
  if (phoneFullPage(route)) {
    return null;
  }
  const current = phoneTabOf(route);
  return (
    <nav className="phone-bar" aria-label="主导航" data-hidden={hidden}>
      {PHONE_TABS.map((tab) => {
        const flagged = tab === 'more' && waiting > 0;
        return (
          <button key={tab} type="button" className="phone-tab" aria-current={current === tab ? 'page' : undefined}
            aria-label={flagged ? `${LABELS[tab]} · 有等你的事` : LABELS[tab]} onClick={() => onTab(tab)}>
            <TabIcon tab={tab} />
            <span aria-hidden="true">{LABELS[tab]}</span>
            {flagged ? <span className="phone-tab-dot" aria-hidden="true" /> : null}
          </button>
        );
      })}
    </nav>
  );
}

export function MoreDrawer({ open, waiting, onClose, onItem, onSettings }: { open: boolean; waiting: number;
  onClose: () => void; onItem: (item: MoreItemId) => void; onSettings: () => void }): ReactNode {
  return (
    <Sheet open={open} variant="drawer" className="sheet-fit more-drawer" title="更多" onClose={onClose}>
      <ul className="more-tiles">
        {MORE_ITEMS.map((item) => {
          const flagged = item.id === 'tasks' && waiting > 0;
          return (
            <li key={item.id}>
              <button type="button" className="more-tile" aria-label={flagged ? `${item.label} · 有等你的事`
                : item.label} onClick={() => onItem(item.id)}>
                <HueTile hue={item.hue} icon={item.icon} size={36} />
                {flagged ? <span className="more-tile-dot" aria-hidden="true" /> : null}
                <span>{item.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <button type="button" className="more-settings" onClick={onSettings}>
        <Icon name="settings" size={18} />
        <span>设置</span>
        <Icon name="chevron-right" size={14} />
      </button>
    </Sheet>
  );
}
