// /v2/events: one Server-Sent Events stream per browser (《实施方案》第 5 节，替掉轮询). Each event's `event:` line
// is its `type`, its `data:` line the JSON below, its `id:` line what to send back as Last-Event-ID after a
// reconnect. When the server can no longer replay from that id (it restarted, or the gap is too long), the
// first event is `ready` with `resync: true`: refetch instead of trusting the stream.
// 这里是零散的几种；整条流上能出现的全部事件见 stream-events.ts（2026-11-05 旧对话、任务、事、自迭代的事件删了）。

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
  // 图书：书的列表或某本书的元数据、标注、进度、大纲重点变了；界面按 bookId 重新拉对应那一块。
  Type.Object({ type: Type.Literal('book_changed'), bookId: IdSchema,
    part: Type.Union([Type.Literal('book'), Type.Literal('annotations'), Type.Literal('progress'),
      Type.Literal('insights')]) }),
  Type.Object({ type: Type.Literal('client_version_changed') }),
  Type.Object({ type: Type.Literal('backups_changed') }),
  // 任务栏目（《优化清单》第 3、4 条）：定时、建议变了，第二栏和主区重读。
  Type.Object({ type: Type.Literal('tasks_changed') }),
  // 第 15 条：Apple 日历和提醒事项的缓存刚从 Mac 同步过（或同步结果变了）：首页「今天」重读。
  Type.Object({ type: Type.Literal('calendar_changed') }),
  // 第 9 条：抖音收藏 / 视频解析有一条变了（同步到了、走了一步）：界面重读那一页。
  Type.Object({ type: Type.Literal('video_changed') }),
  // 第13批：本地转写装的进度和结果。
  TranscriberChangedEventSchema,
  // 竖排网页标签的摆放（11-08 起存在本体里）在别的设备上改了：version 比自己手上的新就重读。
  Type.Object({ type: Type.Literal('web_tabs_changed'), version: Type.Integer({ minimum: 0 }) }),
  // 书签（第 8 批第 1 条，各设备同一份）在别处改了：重读列表。
  Type.Object({ type: Type.Literal('bookmarks_changed') }),
  Type.Object({ type: Type.Literal('money_draft_changed'), draft: MoneyDraftViewSchema }),
  Type.Object({ type: Type.Literal('attachment_changed'), attachment: AttachmentViewSchema }),
  // 联系人（第 113 条）：列表变了、某个联系人的聊天里多了或变了一项。
  ContactsChangedEventSchema,
  ContactItemEventSchema,
  // 第13批：一条新消息该通知（桌面客户端自己弹；网页推送服务端另发）。
  NotifyEventSchema,
  // 第13批：通知按类型的开关在别处改了（桌面客户端自己弹的卡和主线通知按它过滤）。
  NotifyKindsChangedEventSchema,
  ReadyEventSchema,
]);
export type ServerEvent = Static<typeof ServerEventSchema>;
export type ServerEventType = ServerEvent['type'];
