// 心跳先用代码筛（《优化清单》第 11 条，11-06 定）：每一跳要看的几样事从库里读出来——只读，不改。读什么、怎么写成
// 一句话、有没有新变化由 heartbeat/ 决定。原来的几条后台规则（会议邀请、要回复、信息流兴趣）的输入就是这几类触发，
// 现在由心跳统一看（规则关掉，触发照常记）。

import type { Row } from './db.ts';
import type { StoreContext } from './object-store.ts';

export interface MailFactRow {
  id: string;
  kind: string;
  from: string;
  title: string;
  receivedAt: string;
}

export interface WaitingFactRow {
  id: string;
  kind: 'line' | 'ask';
  title: string;
  since: string;
}

export interface ResultFactRow {
  lineId: string;
  title: string;
  updatedAt: string;
}

export interface FriendFactRow {
  id: string;
  kind: 'message' | 'task';
  contact: string;
  text: string;
  at: string;
}

export interface DueFactRow {
  id: string;
  kind: 'todo' | 'project';
  title: string;
  project: string;
  due: string;
}

export interface FeedFactRow {
  id: string;
  title: string;
  at: string;
}

// 一样最多看这么多件：心跳只是看一眼，多出来的下一跳再看。
const LIMIT = 20;

const str = (row: Row, key: string): string => (row[key] === null || row[key] === undefined ? '' : String(row[key]));

export function createHeartbeatFacts(context: StoreContext) {
  const { db } = context;
  return {
    /** 认识的人来信、会议邀请，since 以后到的，还没读、没处理、没归档。 */
    mail(since: string): MailFactRow[] {
      return db.all(`SELECT t.id AS id, t.kind AS kind, m.from_name AS from_name, m.from_address AS from_address,
          m.title AS title, m.received_at AS received_at
        FROM triggers t JOIN inbox_messages m ON t.ref_type = 'inbox_message' AND t.ref_id = m.id
        WHERE t.kind IN ('mail.calendar_invite', 'mail.known_sender', 'calendar.invite')
          AND m.received_at >= $since AND m.read_at IS NULL AND m.handled_at IS NULL AND m.archived_at IS NULL
        ORDER BY m.received_at DESC LIMIT ${LIMIT}`, { since })
        .map((row) => ({ id: str(row, 'id'), kind: str(row, 'kind'),
          from: str(row, 'from_name') || str(row, 'from_address'), title: str(row, 'title'),
          receivedAt: str(row, 'received_at') }));
    },
    /** 等他超过一段时间的：停在「等你」的线、没答的卡。 */
    waiting(before: string): WaitingFactRow[] {
      const lines = db.all(`SELECT id, title, updated_at FROM lines WHERE status = 'waiting' AND archived_at IS NULL
        AND updated_at < $before ORDER BY updated_at LIMIT ${LIMIT}`, { before })
        .map((row) => ({ id: str(row, 'id'), kind: 'line' as const, title: str(row, 'title'),
          since: str(row, 'updated_at') }));
      const asks = db.all(`SELECT id, question, created_at FROM asks WHERE status = 'open' AND created_at < $before
        ORDER BY created_at LIMIT ${LIMIT}`, { before })
        .map((row) => ({ id: str(row, 'id'), kind: 'ask' as const, title: str(row, 'question'),
          since: str(row, 'created_at') }));
      return [...lines, ...asks];
    },
    /**
     * 后台做完、没贴回哪条线的结果（since 以后）：定时卡、订阅自己按卡上写的告诉他，不算在这里。
     */
    results(since: string): ResultFactRow[] {
      return db.all(`SELECT id, title, updated_at FROM lines WHERE kind = 'background' AND status = 'idle'
          AND archived_at IS NULL AND parent_line_id IS NULL AND failure IS NULL AND updated_at >= $since
          AND sealed_prompt IS NULL
          AND id NOT IN (SELECT line_id FROM schedules WHERE line_id IS NOT NULL)
          AND id NOT IN (SELECT line_id FROM space_subscriptions WHERE line_id IS NOT NULL)
          AND id NOT IN (SELECT line_id FROM timed_slots WHERE line_id IS NOT NULL)
        ORDER BY updated_at DESC LIMIT ${LIMIT}`, { since })
        .map((row) => ({ lineId: str(row, 'id'), title: str(row, 'title'), updatedAt: str(row, 'updated_at') }));
    },
    /** 朋友发来还没读的话、发来还没接的任务卡。 */
    friends(): FriendFactRow[] {
      const messages = db.all(`SELECT m.id AS id, c.display_name AS name, m.text AS text, m.sent_at AS sent_at
        FROM contact_messages m LEFT JOIN contacts c ON c.id = m.contact_id
        WHERE m.direction = 'in' AND m.read_at IS NULL AND m.kind IN ('hello', 'text', 'ask_ai')
        ORDER BY m.sent_at DESC LIMIT ${LIMIT}`)
        .map((row) => ({ id: str(row, 'id'), kind: 'message' as const, contact: str(row, 'name'),
          text: str(row, 'text'), at: str(row, 'sent_at') }));
      const tasks = db.all(`SELECT t.id AS id, c.display_name AS name, t.title AS title, t.offered_at AS offered_at
        FROM network_tasks t LEFT JOIN contacts c ON c.id = t.contact_id
        WHERE t.direction = 'in' AND t.state = 'offered' ORDER BY t.offered_at DESC LIMIT ${LIMIT}`)
        .map((row) => ({ id: str(row, 'id'), kind: 'task' as const, contact: str(row, 'name'),
          text: str(row, 'title'), at: str(row, 'offered_at') }));
      return [...messages, ...tasks];
    },
    /** 今天（含）以前到期还没做完的项目待办；过了截止日还在做的项目。 */
    due(today: string): DueFactRow[] {
      const todos = db.all(`SELECT i.id AS id, i.title AS title, i.due AS due, p.name AS project
        FROM project_items i JOIN projects p ON p.id = i.project_id
        WHERE i.target_type = 'todo' AND i.done_at IS NULL AND i.due IS NOT NULL AND i.due <= $today
          AND p.lifecycle = 'active'
        ORDER BY i.due LIMIT ${LIMIT}`, { today })
        .map((row) => ({ id: str(row, 'id'), kind: 'todo' as const, title: str(row, 'title'),
          project: str(row, 'project'), due: str(row, 'due') }));
      const projects = db.all(`SELECT id, name, due FROM projects WHERE lifecycle = 'active' AND due IS NOT NULL
        AND due < $today ORDER BY due LIMIT ${LIMIT}`, { today })
        .map((row) => ({ id: str(row, 'id'), kind: 'project' as const, title: str(row, 'name'),
          project: str(row, 'name'), due: str(row, 'due') }));
      return [...todos, ...projects];
    },
    /** 信息流里命中关注点的（since 以后）。 */
    feed(since: string): FeedFactRow[] {
      return db.all(`SELECT id, summary, received_at FROM triggers WHERE kind = 'feed.interest_hit'
        AND received_at >= $since ORDER BY received_at DESC LIMIT ${LIMIT}`, { since })
        .map((row) => ({ id: str(row, 'id'), title: str(row, 'summary'), at: str(row, 'received_at') }));
    },
  };
}

export type HeartbeatFacts = ReturnType<typeof createHeartbeatFacts>;
