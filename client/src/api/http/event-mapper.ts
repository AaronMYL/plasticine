import type { EveryStreamEvent, LiveEvent } from '../types.ts';

export class ServerEventMapper {
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
      case 'pushes_changed':
        return [{ type: 'pushes.changed' }];
      case 'connections_changed':
        return [{ type: 'connections.changed' }];
      case 'calendar_changed':
        return [{ type: 'calendar.changed' }];
      case 'space_changed':
        return [{ type: 'space.changed', spaceId: event.spaceId }];
      case 'video_changed':
        return [{ type: 'video.changed' }];
      case 'transcriber_changed':
        return [{ type: 'transcriber.changed', status: event.status }];
      case 'web_tabs_changed':
        return [{ type: 'webTabs.changed', version: event.version }];
      case 'bookmarks_changed':
        return [{ type: 'bookmarks.changed' }];
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
      case 'notify':
        return [{ type: 'notify', title: event.title, body: event.body, url: event.url, tag: event.tag,
          conversation: event.conversation }];
      case 'notify_kinds_changed':
        return [{ type: 'notify.kinds', kinds: event.kinds }];
    }
  }
}
