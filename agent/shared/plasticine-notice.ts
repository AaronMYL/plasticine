// Plasticine 自己发给他的通知信（2026-11-04 第 2 批，用户定「通知信不进消息，放常驻项目 Plasticine 的后台」）。
// 查清的来路（main a5cab94）：
//   ① 发：execution/notification-mail.ts 的 NotificationMail 寄给自己（SELF_MAIL_ADDRESS，连上 Gmail 时换成凭据里的
//      地址）。标题「Plasticine：…」的有两处——邮件兜底（attention/mail-fallback.ts：重新登录、任务连续失败）和项目
//      逾期 / 停滞（attention/project-watch.ts）。
//   ② 收：MailSync 收回来时 cloud-tools/own-notice.ts 认「寄件人在收件人里 + 标题 Plasticine·/：开头」，记成
//      source = 'plasticine'、from_address = 'plasticine'；迁移 0048 把以前收成 email 的改过来，0049 收起双胞胎。
//   ③ 直接写：磁盘空间不足（app/disk-notice.ts）、旧服务器迁来的通知，都是 source = 'plasticine'。
// 所以库里的标记就是 source = 'plasticine'。联系人 / 消息列表按它排除（app/contact-mail.ts），后台「通知信」按它列
// （app/backstage.ts），客户端假接口也用它。
// 没覆盖的一种（没有猜）：提醒到点的信（NotificationMail 的 #reminders，标题「提醒：…」）不带 Plasticine 前缀，收回来
// 仍记成 email、发件人是他自己的地址。

import type { InboxSource } from './state.ts';

export const PLASTICINE_NOTICE_SOURCE = 'plasticine' satisfies InboxSource;

export function isPlasticineNotice(message: { source: InboxSource }): boolean {
  return message.source === PLASTICINE_NOTICE_SOURCE;
}
