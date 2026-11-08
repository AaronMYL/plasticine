// 线索键由来源定义（docs/specs/things-and-sources.md 第 2.1 节）：哪几件事件属于同一条「线索」。
// 订阅按它送达，细判按它成批、查重。键里只放标识，不放正文。

import { createHash } from 'node:crypto';

// 链接摘要：够区分条目，又不把整条网址塞进键里。
const DIGEST_CHARS = 16;

function digest(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, DIGEST_CHARS);
}

export const threadKeys = {
  chat: (chatId: string): string => `chat:${chatId}`,
  /** 线程根的 Message-ID；没有 References 就用自己的。 */
  mail: (rootMessageId: string): string => `mail:${rootMessageId}`,
  book: (bookId: string): string => `book:${bookId}`,
  calendar: (uid: string): string => `cal:${uid}`,
  githubRun: (runId: string): string => `gh:run:${runId}`,
  githubIssue: (number: number): string => `gh:issue:${number}`,
  selfJob: (jobId: string): string => `self_job:${jobId}`,
  failure: (lessonKey: string): string => `failure:${lessonKey}`,
  project: (projectId: string): string => `project:${projectId}`,
  feed: (url: string): string => `feed:${digest(url)}`,
  device: (nodeId: string): string => `device:${nodeId}`,
  share: (shareId: string): string => `share:${shareId}`,
  /** 只存粗粒度地点名和日期（规格第 6 节 iPhone 位置）。 */
  place: (place: string, day: string): string => `place:${digest(place)}:${day}`,
  inbox: (source: string, thread: string): string => `inbox:${source}:${thread}`,
  /** 书签按它指的东西（网址或 #/… 地址的摘要；保存的分组按书签自己）。 */
  bookmark: (key: string): string => `bookmark:${digest(key)}`,
  /** 第 113 条：网络上的一个联系人（按对方账号 id）。 */
  contact: (accountId: string): string => `contact:${accountId}`,
};
