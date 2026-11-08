// 首页、对话卡、联系人、群任务和深链接都挂同一个详情入口；没有本地执行线的任务不伪造 lineId。

import type { ReactNode } from 'react';
import type { Route } from '../../shell/routes.ts';
import { LineWorkDetail } from './line-work-detail.tsx';
import { NetworkWorkDetail } from './network-work-detail.tsx';
import './work-detail.css';

export interface WorkDetailProps {
  lineId?: string;
  taskId?: string;
  groupTaskId?: string;
  navigate: (route: Route) => void;
}

export function WorkDetail({ lineId, taskId, groupTaskId, navigate }: WorkDetailProps): ReactNode {
  if (lineId !== undefined) return <LineWorkDetail key={lineId} lineId={lineId} navigate={navigate} />;
  return <NetworkWorkDetail key={groupTaskId ?? taskId} {...taskId === undefined ? {} : { taskId }}
    {...groupTaskId === undefined ? {} : { groupTaskId }}
    navigate={navigate} />;
}
