// 服务端的 SSE 事件 → 界面用的实时事件。服务端给的都是整行 / 整张卡 / 整个视图，这里只换一个名字：卡换成 ask.*，
// 记忆和约定换成 memory / agreement，信息流条目、节点、设备动作、记账、站内信、工具组、云端浏览器、联系人原样带过来。
// 2026-11-05 旧对话的「一轮」（run_started → message_delta → message_created → run_ended）删了：对话走线，线的事件
// 由 events.ts 直接包成 { type: 'line' }，不经这里。

import type { EveryStreamEvent, LiveEvent } from '../types.ts';

export class ServerEventMapper {
  /** 补不上了（resync）：没有要清的状态（以前要清旧对话的草稿），留着给调用方统一调。 */
  reset(): void {}

  apply(event: EveryStreamEvent): LiveEvent[] {
    switch (event.type) {
      case 'attachment_changed':
        return [{ type: 'attachment.changed', attachment: event.attachment }];
      case 'money_draft_changed':
        return [{ type: 'money-draft.changed', draft: event.draft }];
      case 'client_version_changed':
        return [{ type: 'client.versionChanged' }];
      case 'note_invalidated':
        return [{ type: 'note.invalidated', noteId: event.noteId }];
      case 'project_invalidated':
        return [{ type: 'project.invalidated', projectId: event.projectId }];
      case 'book_changed':
        return [{ type: 'book.changed', bookId: event.bookId, part: event.part }];
      case 'backups_changed':
        return [{ type: 'backups.changed' }];
      case 'tasks_changed':
        return [{ type: 'tasks.changed' }];
      case 'calendar_changed':
        return [{ type: 'calendar.changed' }];
      case 'video_changed':
        return [{ type: 'video.changed' }];
      case 'web_tabs_changed':
        return [{ type: 'webTabs.changed', version: event.version }];
      case 'node_changed':
        return [{ type: 'node.changed', node: event.node }];
      case 'node_action_recorded':
        return [{ type: 'node_action.recorded', action: event.action }];
      case 'money_changed':
        return [{ type: 'money.changed', entry: event.entry }];
      case 'inbox_changed':
        return [{ type: 'inbox.changed', message: event.message, unread: event.unread }];
      case 'tool_group_changed':
        return [{ type: 'tool_group.changed', group: event.group }];
      case 'browser_changed':
        return [{ type: 'browser.changed', browser: event.browser }];
      case 'feed_item_changed':
        return [{ type: 'feed.changed', item: event.item }];
      case 'memory_entry_changed':
        return [{ type: 'memory.changed', entry: event.entry }];
      case 'agreement_changed':
        return [{ type: 'agreement.changed', agreement: event.agreement }];
      case 'ask_created':
        return [{ ...event, type: 'ask.created' }];
      case 'ask_answered':
        return [{ ...event, type: 'ask.answered' }];
      case 'ask_updated':
        return [{ ...event, type: 'ask.updated' }];
      case 'ready':
        return event.resync ? [{ type: 'resync' }] : [];
      case 'contacts_changed':
        return [{ type: 'contacts.changed', waiting: event.waiting, unread: event.unread }];
      case 'contact_item':
        return [{ type: 'contact.item', contactId: event.contactId, item: event.item }];
    }
  }
}
