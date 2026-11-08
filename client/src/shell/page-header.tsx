// 主区页头：标题、元信息与本页操作；通用操作用有名称的图标，给正文留出空间。
// 设计稿 2026-11-03：电脑上后退和查找在顶栏（标签旁边），页头只留本页的东西；手机没有顶栏，后退和查找照旧在页头。
// 第 106、111 条：铃去掉了——站内信并进联系人（侧栏「联系人」），Plasticine 的通知进「设置 · 通知记录」，不留旧入口。

import type { ReactNode } from 'react';
import { IconButton } from './icon-button.tsx';
import { useOpenPanel } from './panel.ts';
import { useRoute } from './use-route.ts';
import { PHONE_BELOW } from './layout.ts';
import { useViewportWidth } from './use-viewport-width.ts';

export interface PageHeaderProps {
  title: string;
  /** 标题后面常显的一小句（这一页的状态，比如「项目 · 进行中」）；只放必要的，冗余的数不要传。 */
  meta?: string | undefined;
  controls?: ReactNode;
  /** 手机页头右边、查找后面的本页图标（2026-11-05 设计稿 Phone-Notes 的「新建」、Phone-Feed 的「筛选」）。 */
  phoneTools?: ReactNode;
  /** 手机页头带不带查找（Phone-Feed 只有筛选）。 */
  phoneSearch?: boolean;
  /** 手机上标题左边的返回（这一页自己的上一层，比如笔记的文件夹列表回首层）；不给就按浏览记录。 */
  onBack?: (() => void) | undefined;
}

export function PageHeader({ title, meta, controls, phoneTools, phoneSearch = true, onBack }: PageHeaderProps)
  : ReactNode {
  const openPanel = useOpenPanel();
  const { canGoBack, goBack } = useRoute();
  const phone = useViewportWidth() < PHONE_BELOW;
  return (
    <header className="page-head">
      <div className="page-head-title">
        {phone && onBack !== undefined ? <IconButton icon="back" label="回到上一层" className="page-back" onClick={onBack} />
          : canGoBack && phone ? <IconButton icon="back" label="回到上一页" className="page-back" onClick={goBack} />
            : null}
        {/* 2026-11-03《全量界面优化》：页头不写副标题，数字进分段控件。11-04 重做悬停：不再藏在标题的悬停里——
            必要的（这一页的状态）常显在标题后面，冗余的（和分段控件重复的数、今天几号）调用方不再传。 */}
        <h1>{title}</h1>
        {meta === undefined ? null : <span className="page-head-status">{meta}</span>}
      </div>
      {controls === undefined ? null : <div className="page-head-controls">{controls}</div>}
      {phone && (phoneSearch || phoneTools !== undefined) ? (
        <div className="page-head-tools">
          {phoneSearch ? <IconButton icon="search" label="查找内容" size={17}
            onClick={() => openPanel({ kind: 'search' })} /> : null}
          {phoneTools}
        </div>
      ) : null}
    </header>
  );
}
