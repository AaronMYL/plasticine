// 本机自己报的实时事件。服务端的 /v2/events 没有笔记事件，所以笔记写成功后由 http/notes.ts 在这里报一声
// note.updated / note.deleted，列表和打开的编辑器照旧刷新；别的设备改的笔记要等重新拉列表或 resync 才看得到。

import type { LiveEvent } from '../types.ts';

export type LiveListener = (event: LiveEvent) => void;

export class LocalEvents {
  private readonly listeners = new Set<LiveListener>();

  on(listener: LiveListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: LiveEvent): void {
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }
}
