// 刷新或关掉页面前，还有没完成的内容时让浏览器先问一句：没存上的笔记草稿、输入框里的字或引用片、
// 还没拿到回执的发送（发送中 / 待核实 / 没送到 / 失败）、还在路上或待核实的笔记新建 / 删除、任务命令和作答、
// 记忆 / 判断页里没存上的编辑草稿、还没了结的确认操作（改 p、记结果、确认约定）。
// 切视图不用问：这些都在 state/ 里，回来还在。
// 挂在 App 上、配对门之外：401 回到配对页时壳卸掉了，提醒照样在。

import { useEffect } from 'react';
import type { ClientState } from '../state/context.tsx';

export type UnsavedState = Pick<ClientState, 'noteDrafts' | 'conversationUi' | 'outbox' | 'noteOps'> &
  Partial<Pick<ClientState, 'actionOps' | 'inlineDrafts' | 'editDrafts' | 'signedOps'
    | 'attachments' | 'conversations'>>;

export function hasUnsavedWork(state: UnsavedState): boolean {
  const composer = state.conversationUi.store.get();
  const composerHasWork =
    (composer.draft.trim() !== '' || composer.quotes.length > 0) && !state.conversationUi.savedForRefresh();
  // 任务条、卡上就地写了一半的一句也算（审查 88c54ec P1）。
  const actionsPending = (state.actionOps?.hasPending() ?? false) || (state.inlineDrafts?.hasAny() ?? false);
  const notesPending = state.noteDrafts.hasAny() || state.noteOps.hasPending();
  const cognitionPending = (state.editDrafts?.hasAny() ?? false) || (state.signedOps?.hasPending() ?? false);
  return (
    notesPending ||
    (state.conversations?.hasDrafts() ?? composerHasWork) ||
    state.outbox.hasAny() ||
    actionsPending ||
    cognitionPending ||
    (state.conversations?.hasAttachments() ?? state.attachments?.hasAny() ?? false)
  );
}

export function useUnsavedGuard(state: UnsavedState): void {
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (hasUnsavedWork(state)) {
        event.preventDefault();
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [state]);
}
