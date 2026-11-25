import { Type, type Static } from 'typebox';
import { API_PREFIX, IdSchema } from './common.ts';
import { AttachmentViewSchema } from '../attachments.ts';
import { MoneyDraftViewSchema } from './money-drafts.ts';
import { ContactItemEventSchema, ContactsChangedEventSchema } from './contacts.ts';
import { NotifyEventSchema, NotifyKindsChangedEventSchema } from './push.ts';
import { TranscriberChangedEventSchema } from './video.ts';

export const EVENTS_PATH = `${API_PREFIX}/events`;

export const ReadyEventSchema = Type.Object({ type: Type.Literal('ready'), resync: Type.Boolean() });

export const ServerEventSchema = Type.Union([
  Type.Object({ type: Type.Literal('space_changed'), spaceId: IdSchema }),
  Type.Object({ type: Type.Literal('note_invalidated'), noteId: IdSchema }),
  Type.Object({ type: Type.Literal('project_invalidated'), projectId: IdSchema }),
  Type.Object({ type: Type.Literal('book_changed'), bookId: IdSchema,
    part: Type.Union([Type.Literal('book'), Type.Literal('annotations'), Type.Literal('progress'),
      Type.Literal('insights')]) }),
  Type.Object({ type: Type.Literal('client_version_changed') }),
  Type.Object({ type: Type.Literal('backups_changed') }),
  Type.Object({ type: Type.Literal('tasks_changed') }),
  Type.Object({ type: Type.Literal('pushes_changed') }),
  Type.Object({ type: Type.Literal('connections_changed') }),
  Type.Object({ type: Type.Literal('calendar_changed') }),
  Type.Object({ type: Type.Literal('video_changed') }),
  TranscriberChangedEventSchema,
  Type.Object({ type: Type.Literal('web_tabs_changed'), version: Type.Integer({ minimum: 0 }) }),
  Type.Object({ type: Type.Literal('bookmarks_changed') }),
  Type.Object({ type: Type.Literal('money_draft_changed'), draft: MoneyDraftViewSchema }),
  Type.Object({ type: Type.Literal('attachment_changed'), attachment: AttachmentViewSchema }),
  ContactsChangedEventSchema,
  ContactItemEventSchema,
  NotifyEventSchema,
  NotifyKindsChangedEventSchema,
  ReadyEventSchema,
]);
export type ServerEvent = Static<typeof ServerEventSchema>;
