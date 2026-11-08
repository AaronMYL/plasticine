// 网络任务复用本地工作详情；远端、人接手和未认领的任务保留真实卡片语义，不造执行线或假进度。

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import type { GroupTaskView, NetworkTaskView } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { Markdown } from '../../primitives/message/markdown.tsx';
import type { Route } from '../../shell/routes.ts';
import { useStore } from '../../state/use-store.ts';
import { GroupTaskCard } from '../contacts/group-task-card.tsx';
import { TaskDetailActions } from '../contacts/task-card.tsx';
import { LineWorkDetail } from './line-work-detail.tsx';
import { WorkRequest } from './work-content.tsx';
import { WorkRevision } from './work-revision.tsx';

export interface NetworkWorkDetailProps {
  taskId?: string;
  groupTaskId?: string;
  navigate: (route: Route) => void;
}

export function NetworkWorkDetail({ taskId, groupTaskId, navigate }: NetworkWorkDetailProps): ReactNode {
  const api = useApi();
  const live = useLive();
  const contacts = useStore(live.contacts.list.data).value;
  const [task, setTask] = useState<NetworkTaskView | null>(null);
  const [group, setGroup] = useState<GroupTaskView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const reload = useCallback(async (): Promise<void> => {
    const current = ++generation.current;
    try {
      if (groupTaskId !== undefined) {
        const next = await api.groupTasks.get(groupTaskId);
        if (current !== generation.current) return;
        setGroup(next);
        setTask(next.pair);
      } else if (taskId !== undefined) {
        const next = await api.networkTasks.get(taskId);
        if (current !== generation.current) return;
        setTask(next);
      } else {
        throw new Error('这条地址里没有工作。');
      }
      setError(null);
    } catch (cause) {
      if (current === generation.current) setError(errorText(cause));
    } finally {
      if (current === generation.current) setLoaded(true);
    }
  }, [api, taskId, groupTaskId]);
  useEffect(() => {
    void reload();
    return () => { generation.current += 1; };
  }, [reload]);
  useEffect(() => live.hub.on((event) => {
    if (event.type === 'resync' || event.type === 'ask.answered' || event.type === 'contacts.changed') void reload();
    if (event.type !== 'contact.item') return;
    if (event.item.type === 'group_task' && event.item.task.id === groupTaskId) {
      generation.current += 1;
      setGroup(event.item.task);
      setTask(event.item.task.pair);
    }
    if (event.item.type === 'task' && event.item.task.id === taskId) {
      generation.current += 1;
      setTask(event.item.task);
    }
  }), [live, reload, taskId, groupTaskId]);
  const name = group === null ? contacts?.contacts.find((contact) => contact.id === task?.contactId)?.name ?? '对方'
    : group.owner.self ? group.claimer?.name ?? '对方' : group.owner.name;
  const revision = task !== null && task.direction === 'in' && task.doer === 'ai' && task.state === 'rejected';
  const before = task === null || !revision ? null : <WorkRevision task={task} name={name}
    onAnswered={() => void reload()} />;
  const actions = task === null || revision ? null : <TaskDetailActions task={task} name={name} />;
  if (task?.localTaskId != null && task.direction === 'in') return <LineWorkDetail lineId={task.localTaskId}
    navigate={navigate} task={task} before={before} actions={actions}
    hideComposer={revision || task.doer !== 'ai' || !['accepted', 'in_progress'].includes(task.state)} />;
  if (!loaded || task === null && group === null) return <div className="work-placeholder"
    role={error === null ? 'status' : 'alert'}><p>{error ?? '正在读工作…'}</p>
    {error === null ? null : <button type="button" className="secondary-button" onClick={() => void reload()}>
      重试</button>}</div>;
  return <div className="work-detail"><div className="work-scroll">
    <header className="work-title"><h2>{task?.title ?? group?.title}</h2></header>
    {error === null ? null : <p className="work-error" role="alert">{error}
      <button type="button" className="text-button" onClick={() => void reload()}>重试</button></p>}
    {before}
    {task?.doer === 'person' && task.direction === 'in' ? <p className="work-manual">这份交付由你处理</p> : null}
    <WorkRequest request={{ text: task?.goal ?? group?.goal ?? '', source: null }} />
    {task?.delivery == null ? null : <section className="work-section"><h3>交付结果</h3>
      <Markdown text={task.delivery.text} /></section>}
    {task !== null ? actions : group === null ? null : <GroupTaskCard task={group} now={new Date()}
      navigate={navigate} detail />}
  </div></div>;
}
