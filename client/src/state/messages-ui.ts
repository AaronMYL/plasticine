import { Store } from './store.ts';
import { DEFAULT_MESSAGE_FILTER, type MessageFilter } from './message-filter.ts';

export class MessagesUi {
  readonly filter = new Store<MessageFilter>(DEFAULT_MESSAGE_FILTER);

  setFilter(filter: MessageFilter): void {
    this.filter.set(filter);
  }
}
