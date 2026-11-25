import type { Row } from './db.ts';
import type { StoreContext } from './object-store.ts';

export interface MailFactRow {
  id: string;
  kind: 'invite' | 'known_sender';
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

const LIMIT = 20;

const INVITE = `EXISTS (SELECT 1 FROM json_each(m.attachments) a
  WHERE lower(a.value) LIKE '%.ics' OR lower(a.value) LIKE '%.vcs')`;
const KNOWN_SENDER = `EXISTS (SELECT 1 FROM inbox_replies r JOIN inbox_messages earlier ON earlier.id = r.message_id
  WHERE earlier.from_address = m.from_address AND r.sent_at IS NOT NULL)`;

const str = (row: Row, key: string): string => (row[key] === null || row[key] === undefined ? '' : String(row[key]));

export function createHeartbeatFacts(context: StoreContext) {
  const { db } = context;
  return {
    mail(since: string): MailFactRow[] {
      return db.all(`SELECT m.id AS id, ${INVITE} AS invite, m.from_name AS from_name,
          m.from_address AS from_address, m.title AS title, m.received_at AS received_at
        FROM inbox_messages m
        WHERE m.source = 'email' AND m.duplicate_of IS NULL AND (${INVITE} OR ${KNOWN_SENDER})
          AND m.received_at >= $since AND m.read_at IS NULL AND m.handled_at IS NULL AND m.archived_at IS NULL
        ORDER BY m.received_at DESC LIMIT ${LIMIT}`, { since })
        .map((row) => ({ id: str(row, 'id'), kind: Number(row['invite']) === 1 ? 'invite' as const
          : 'known_sender' as const, from: str(row, 'from_name') || str(row, 'from_address'),
        title: str(row, 'title'), receivedAt: str(row, 'received_at') }));
    },
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
    feed(since: string): FeedFactRow[] {
      return db.all(`SELECT id, title, arrived_at FROM feed_items WHERE concern_id IS NOT NULL
        AND arrived_at >= $since AND (reaction IS NULL OR reaction <> 'dislike')
        ORDER BY arrived_at DESC, id DESC LIMIT ${LIMIT}`, { since })
        .map((row) => ({ id: str(row, 'id'), title: str(row, 'title'), at: str(row, 'arrived_at') }));
    },
  };
}

