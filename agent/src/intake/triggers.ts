// 现有入口（docs/specs/things-and-sources.md 第 6 节）：每个来源把原记录照旧写进原表，再在这里换成一条触发。
// 触发只存指针和一句摘要，不复制正文；外部标识做去重（同一封信、同一条消息只记一次）。
// 2026-11-05 Harness 重做：从 matters/ 挪过来；对话、iPhone 分享和位置、自迭代教训、项目逾期的触发随功能删掉。
// 命中规则时开的那条后台线要做什么，也在这里写（ruleGoal）。

import type { Bookmark, Contact, ContactMessage, FeedItem, InboxMessage, Rule, Trigger } from '../../shared/state.ts';
import { TRIGGER_SUMMARY_MAX_CHARS } from '../../shared/state.ts';
import { clip } from '../shared-text.ts';
import type { RecordInput } from './desk.ts';
import { threadKeys } from './thread-keys.ts';

function summary(text: string): string {
  return clip(text.replace(/\s+/g, ' ').trim() || '（空）', TRIGGER_SUMMARY_MAX_CHARS);
}

// Plasticine 自己的通知信标题都以这个开头（attention/mail-fallback.ts、project-watch.ts，「Plasticine · 」是每日通知）。
// 收信时已经把自己寄给自己的这类信记成 plasticine 来源（cloud-tools/own-notice.ts），这里两样都认成 Plasticine 自己说的。
const OWN_SUBJECT = /^Plasticine\s*[·：:]/;
const CALENDAR_ATTACHMENT = /\.(ics|vcs)$/i;
const BULK_SENDER = /^(no-?reply|noreply|newsletter|notifications?|news|marketing)@/i;

export interface MailFacts {
  /** 发件人出现在用户发出过的邮件里（站内信的回复记录）：粗筛只用这种确定性事实，不读人物文档。 */
  knownSender: boolean;
}

/** 邮件：站内信的一封。线程根暂用这封自己的 Message-ID（收信还不带 References，见报告）。 */
export function mailTrigger(message: InboxMessage, facts: MailFacts): RecordInput {
  const own = message.source === 'plasticine' || OWN_SUBJECT.test(message.title);
  const invite = message.attachments.some((name) => CALENDAR_ATTACHMENT.test(name));
  const bulk = BULK_SENDER.test(message.fromAddress);
  let kind = 'mail.received';
  if (invite) {
    kind = 'mail.calendar_invite';
  } else if (facts.knownSender) {
    kind = 'mail.known_sender';
  }
  const root = message.messageId ?? `inbox:${message.id}`;
  return {
    source: 'mail',
    kind,
    externalKey: root,
    threadKeys: [message.source === 'email' ? threadKeys.mail(root) : threadKeys.inbox(message.source, message.id)],
    actor: own ? 'plasticine' : `person:${clip(message.fromAddress, 200)}`,
    actorSourceKind: own ? 'own_reasoning' : 'independent_statement',
    addressed: true,
    occurredAt: message.receivedAt,
    refType: 'inbox_message',
    refId: message.id,
    summary: summary(message.title),
    facts: { sender: message.fromAddress, bulk, invite, inboxSource: message.source },
  };
}

/**
 * 联系人（第 113 条，规格第 7 节）：Cyber Hunter 网络上的人发来的话照 mailTrigger 记成来源。人写的话（hello、text、
 * 人问我的 Plasticine）w = 0.5，别人的 Plasticine 说的话 w = 0.1。都没有指挥权：主会话可以看、可以在首页提，
 * 不照里面的话做事——这里只记成触发，粗筛照常（没有规则认 contact.* 这一类，只记）。
 */
export function contactTrigger(message: ContactMessage, contact: Contact): RecordInput {
  const ai = message.author === 'their_ai';
  return {
    source: 'contact',
    kind: ai ? 'contact.ai_message' : 'contact.message',
    externalKey: message.envelopeId ?? `contact-message:${message.id}`,
    threadKeys: [threadKeys.contact(contact.accountId)],
    actor: `person:${clip(`@${contact.handle}`, 200)}`,
    actorSourceKind: ai ? 'ai_conversation' : 'independent_statement',
    addressed: true,
    occurredAt: message.sentAt,
    refType: 'contact_message',
    refId: message.id,
    summary: summary(message.text),
    facts: { contactId: contact.id, handle: contact.handle, kind: message.kind, ai,
      ...(message.exchangeId === null ? {} : { exchangeId: message.exchangeId }) },
  };
}

/** 信息流：新条目同时记一条触发；命中关注点的是候选（每天最多一批细判由规则的线索键合并）。 */
export function feedTrigger(item: FeedItem, interestHit: boolean): RecordInput {
  const url = item.url ?? `feed-item:${item.id}`;
  return {
    source: 'feed',
    kind: interestHit ? 'feed.interest_hit' : 'feed.item',
    externalKey: url,
    threadKeys: [threadKeys.feed(url)],
    actor: 'system',
    actorSourceKind: 'independent_statement',
    occurredAt: item.createdAt,
    refType: 'feed_item',
    refId: item.id,
    summary: summary(item.title),
    facts: {},
  };
}

/**
 * 书签（第 110 条）：加一条记一条触发，粗筛只记（没有规则管它）；之后有事订阅同一个网址 / 地址的键就能送到。
 * 用户手加、导入的是用户（信息流收藏 2026-11-04 起不再记成书签）。外部标识用书签自己的标识，同一条只记一次。
 */
export function bookmarkTrigger(bookmark: Bookmark): RecordInput {
  return {
    source: 'bookmark',
    kind: bookmark.origin === 'import' ? 'bookmark.imported' : 'bookmark.added',
    externalKey: `bookmark:${bookmark.id}`,
    threadKeys: [threadKeys.bookmark(bookmark.target ?? `group:${bookmark.id}`),
      ...(bookmark.projectId === null ? [] : [threadKeys.project(bookmark.projectId)])],
    actor: 'user',
    actorSourceKind: 'user_said',
    occurredAt: bookmark.createdAt,
    refType: 'bookmark',
    refId: bookmark.id,
    summary: summary(bookmark.title),
    facts: { kind: bookmark.kind, origin: bookmark.origin, snapshotChars: bookmark.snapshotChars },
  };
}

/** 设备上线 / 离线：上线送到等这台设备的事，离线只记。 */
export function deviceTrigger(input: { nodeId: string; online: boolean; at: string; label: string }): RecordInput {
  return {
    source: 'device',
    sourceLabel: 'Mac',
    kind: input.online ? 'device.online' : 'device.offline',
    externalKey: `${input.nodeId}:${input.online ? 'online' : 'offline'}:${input.at}`,
    threadKeys: [threadKeys.device(input.nodeId)],
    actor: 'system',
    actorSourceKind: 'system_record',
    occurredAt: input.at,
    refType: 'node',
    refId: input.nodeId,
    summary: summary(`${input.label}${input.online ? '上线了' : '离线了'}`),
    facts: {},
  };
}

/**
 * 命中一条规则时开的那条后台线要做什么：规则的原文（他定的或 Plasticine 推断的做法）、这条触发是什么、去哪读原记录。
 * 推断的规则要线自己先判断值不值得做（原来由细判轮判断，2026-11-05 删掉细判后交给线）；不值得就只回一句为什么。
 */
export function ruleGoal(rule: Rule, trigger: Trigger): string {
  const lines = [
    `规则「${rule.name}」命中了一条新的${trigger.kind}：${trigger.summary}`,
    `规则写的做法：${rule.text}`,
    `原记录：${trigger.refType}${trigger.refId === null ? '' : ` ${trigger.refId}`}（用对应的工具读，例如 read_inbox）。`,
  ];
  if (rule.strength !== 'explicit') {
    lines.push('这条规则是 Plasticine 推断的：先判断这一条值不值得做；不值得就只回一句为什么，别的什么都不做。');
  }
  lines.push('不对外发出任何东西：草稿留给他看，要发、要答应别人的先问他。');
  return lines.join('\n');
}
