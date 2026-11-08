// 邮件阅读区里不画界面的两样：「在 Gmail 打开」按发件地址和主题去找（服务端没给 Gmail 里那一封的直接地址），
// 同一个地址的信新的在前、我回的那几句不算。

import { describe, expect, it } from 'vitest';
import type { ContactMessageView } from '../../../src/api/shared.ts';
import { gmailSearchUrl, mailsOf } from '../../../src/views/messages/mail-reader.tsx';

function message(id: string, at: string, fields: Partial<ContactMessageView> = {}): ContactMessageView {
  return { id, author: 'them', text: id, at, status: 'sent', toAi: false, exchangeId: null, taskId: null,
    mail: { subject: id, fromName: null, fromAddress: 'a@example.com', html: false, attachments: [] }, ...fields };
}

describe('邮件阅读区', () => {
  it('在 Gmail 打开：按地址和主题搜，主题里的引号换成空格；没有主题只按地址', () => {
    const url = gmailSearchUrl('news@example.com', '第 42 期："本地优先"这一年');
    expect(url.startsWith('https://mail.google.com/mail/u/0/#search/')).toBe(true);
    expect(decodeURIComponent(url.split('#search/')[1] ?? ''))
      .toBe('in:anywhere from:news@example.com subject:"第 42 期： 本地优先 这一年"');
    expect(decodeURIComponent(gmailSearchUrl('a@example.com', '  ').split('#search/')[1] ?? ''))
      .toBe('in:anywhere from:a@example.com');
  });

  it('这个地址来的信新的在前；我回的、没有邮件抬头的不算', () => {
    const reply = message('reply', '2026-11-03T01:00:00.000Z', { author: 'me' });
    delete reply.mail;
    const mails = mailsOf([
      message('old', '2026-11-01T01:00:00.000Z'),
      reply,
      message('new', '2026-11-04T01:00:00.000Z'),
    ]);
    expect(mails.map((mail) => mail.id)).toEqual(['new', 'old']);
  });
});
