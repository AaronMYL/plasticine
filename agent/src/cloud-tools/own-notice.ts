// Plasticine 自己的通知信（第 113 条，站内信并进联系人）：寄件人和收件人是同一个地址、标题以「Plasticine ·」
// 「Plasticine：」开头。收进来记成 plasticine 来源，进「设置 · 通知记录」，不当成一个邮件联系人。
// 只认自己寄给自己的：别人寄来的信标题再像通知，也照样是那个人的信。
// 迁移 0048-own-notices 用同一条规则把已经收进来的改过来（那边是 SQL，两边一起改）。

const OWN_NOTICE_TITLE = /^Plasticine\s*[·：:]\s*/;

export interface NoticeCandidate {
  fromAddress: string;
  toAddress: string | null;
  subject: string;
}

/** 是 Plasticine 自己的通知时返回去掉前缀的标题（可能是空串）；不是返回 null。 */
export function ownNoticeTitle(mail: NoticeCandidate): string | null {
  const from = mail.fromAddress.trim().toLowerCase();
  if (from === '' || !(mail.toAddress ?? '').toLowerCase().includes(from)) {
    return null;
  }
  const subject = mail.subject.trim();
  const prefix = OWN_NOTICE_TITLE.exec(subject);
  if (prefix === null) {
    return null;
  }
  return subject.slice(prefix[0].length).trim();
}
