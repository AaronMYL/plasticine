const OWN_NOTICE_TITLE = /^Plasticine\s*[·：:]\s*/;

export interface NoticeCandidate {
  fromAddress: string;
  toAddress: string | null;
  subject: string;
}

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
