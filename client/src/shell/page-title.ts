// 一页叫什么（对话框顶上跟着当前页写它，⌘K 也用）：按地址算——笔记看缓存里的标题、项目看项目名、记忆主题看目录、
// 联系人看联系人列表，别的写视图名。网页标签用网页标题，没有就写网址。

import { useLive } from '../live.tsx';
import { useClientState } from '../state/context.tsx';
import { useStore } from '../state/use-store.ts';
import { navLabel, type Route } from './routes.ts';

export function usePageTitle(): (route: Route) => string {
  const { notesCache } = useClientState();
  const notes = useStore(notesCache.store);
  const live = useLive();
  const topics = useStore(live.memoryTopics.data);
  useStore(live.bookmarks.data);
  const roster = useStore(live.mates.data);
  const contacts = useStore(live.contacts.list.data);
  return (route) => {
    if (route.view === 'plasticine' && route.lineId != null) {
      return live.lines.lineOf(route.lineId)?.title ?? '对话';
    }
    if (route.view === 'plasticine') {
      if (route.mateId != null) return roster.mates.find((mate) => mate.id === route.mateId)?.name ?? '队友';
      if (route.mateGroupId != null) return roster.groups.find((group) => group.id === route.mateGroupId)?.name ?? '群组';
      return '主线';
    }
    if (route.view === 'notes' && route.noteId !== null) {
      return notes.get(route.noteId)?.note?.title || '笔记';
    }
    if (route.view === 'projects' && route.projectId != null) {
      return live.bookmarks.project(route.projectId)?.name ?? navLabel('projects');
    }
    if (route.view === 'memory' && route.topicId != null) {
      const groups = topics.list?.groups ?? [];
      return groups.flatMap((group) => group.topics).find((topic) => topic.id === route.topicId)?.title ?? '记忆';
    }
    if (route.view === 'memory' && route.memoryDream === true) {
      return '昨晚整理了什么';
    }
    if (route.view === 'memory' && route.memoryRules === true) return '规则';
    if (route.view === 'memory' && route.memoryConflicts === true) return '说法冲突';
    if (route.view === 'books' && (route.spaceId != null || route.spacesList === true)) {
      return navLabel('library');
    }
    if (route.view === 'library' && route.libraryTrash === true) {
      return '最近删除';
    }
    if (route.view === 'tools' && route.tool != null) {
      return route.tool;
    }
    if ((route.view === 'contacts' || route.view === 'messages') && route.contactId != null) {
      return contacts.value?.contacts.find((row) => row.id === route.contactId)?.name ?? navLabel('contacts');
    }
    if ((route.view === 'contacts' || route.view === 'messages') && route.contactPane === 'requests') {
      return '新请求';
    }
    return navLabel(route.view);
  };
}
