// 消息第二栏（《优化清单》第 2 条）的筛选：联系人 / 群组 / 邮件 / 全部（先看联系人）。电脑上在第二栏，手机上在消息列表页，两处共用这一份；
// 只记在这次打开的窗口里。

import { Store } from './store.ts';
import { DEFAULT_MESSAGE_FILTER, type MessageFilter } from '../views/messages/message-filter.ts';

export class MessagesUi {
  readonly filter = new Store<MessageFilter>(DEFAULT_MESSAGE_FILTER);

  setFilter(filter: MessageFilter): void {
    this.filter.set(filter);
  }
}
