// 消息第二栏（《优化清单》第 2 条）的筛选：全部 / 人 / 群 / 邮件。电脑上在第二栏，手机上在消息列表页，两处共用这一份；
// 只记在这次打开的窗口里。

import { Store } from './store.ts';
import type { MessageFilter } from '../views/messages/message-filter.ts';

export class MessagesUi {
  readonly filter = new Store<MessageFilter>('all');

  setFilter(filter: MessageFilter): void {
    this.filter.set(filter);
  }
}
