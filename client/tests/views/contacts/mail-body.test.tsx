// 邮件按原样显示（用户 2026-11-04 定）：一封信点开是整宽阅读区，不进聊天气泡；HTML 进沙箱 iframe（不给 allow-scripts，
// CSP 只放 data: 和本站的图，链接开新窗口、不带来源）；只有纯文字的照原段落、网址可点。消息里点开一个邮件地址默认看最新一封。

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { seedContacts } from '../../../src/api/fake/contacts-seed.ts';
import type { FakeApi } from '../../../src/api/fake/index.ts';
import { MAIL_SANDBOX, MailBody, mailDocument } from '../../../src/views/contacts/mail-body.tsx';
import { NOW, renderApp, settle } from '../../helpers.tsx';

function seed(fake: FakeApi): void {
  const { contacts, m5b, network, visibility } = fake.control;
  seedContacts({ contacts, inbox: m5b.inbox, network, visibility }, NOW);
}

describe('邮件正文', () => {
  it('HTML 信放进沙箱 iframe：没有 allow-scripts，srcdoc 带 CSP、不带来源、链接开新窗口，正文原样在里面', () => {
    render(<MailBody subject="本周精选" html={'<p style="color:#c00">你好 <b>加粗</b></p>'} text="你好 加粗" />);
    const frame = screen.getByTitle('邮件正文：本周精选') as HTMLIFrameElement;
    const sandbox = frame.getAttribute('sandbox') ?? '';
    expect(sandbox).toBe(MAIL_SANDBOX);
    expect(sandbox).not.toMatch(/allow-scripts|allow-forms|allow-top-navigation/);
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    const doc = frame.getAttribute('srcdoc') ?? '';
    expect(doc).toContain(`img-src data: ${window.location.origin};`);
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain('<meta name="referrer" content="no-referrer">');
    expect(doc).toContain('<base target="_blank">');
    expect(doc).toContain('<p style="color:#c00">你好 <b>加粗</b></p>');
    expect(doc).toMatch(/body\{[^}]*background:#ffffff/);
  });

  it('srcdoc 的 CSP 只认传进来的那个来源', () => {
    const policy = "default-src 'none'; img-src data: https://plasticine.test; "
      + "style-src 'unsafe-inline'; font-src data:";
    expect(mailDocument('<p>x</p>', 'https://plasticine.test')).toContain(`content="${policy}"`);
  });

  it('只有纯文字的信：按空行分段、段里换行照原样，网址可点、开新窗口', () => {
    render(<MailBody subject="通知" html={null} text={'第一行\n第二行\n\n详情见 https://example.com/a?b=1，谢谢'} />);
    const paragraphs = document.querySelectorAll('.mail-text p');
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]?.textContent).toBe('第一行\n第二行');
    const link = screen.getByRole('link', { name: 'https://example.com/a?b=1' });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(document.querySelector('iframe')).toBeNull();
  });
});

describe('消息 · 邮件阅读区', () => {
  it('邮件不进气泡：点开一个地址是整宽阅读区，最新一封（HTML 正文进沙箱 iframe）；点更早的一封是纯文字正文', async () => {
    await renderApp({ hash: `#/messages/${encodeURIComponent('mail:noreply@aliyun.com')}`, width: 1440, setup: seed });
    await settle();
    const reader = await screen.findByRole('article', { name: /到期/ });
    expect(reader.querySelector('.cm-bubble')).toBeNull();
    expect(reader.querySelector('.mail-reader-address')?.textContent).toBe('noreply@aliyun.com');
    const frame = await waitFor(() => {
      const found = reader.querySelector('iframe');
      expect(found).not.toBeNull();
      return found as HTMLIFrameElement;
    });
    expect(frame.getAttribute('sandbox')).not.toContain('allow-scripts');
    expect(frame.getAttribute('srcdoc')).toContain('立即续费');

    fireEvent.click(within(reader).getByRole('button', { name: /10 月账单已出/ }));
    await waitFor(() => expect(reader.querySelector('.mail-text p')?.textContent)
      .toBe('您 10 月的账单已出，金额 ¥86.40。'));
    expect(reader.querySelector('iframe')).toBeNull();
    expect(reader.closest('.cm-line')).toBeNull();
  });
});
