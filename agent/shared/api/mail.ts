// SPDX-License-Identifier: Apache-2.0
// 邮件按原样显示（用户 2026-11-04 弹框定）：联系人里一封邮件点开是整宽的阅读区，不进聊天气泡。
// - GET /v2/contacts/:id/mail/:mailId → 这封信的正文：清洗后的 HTML（cid: 已换成 data:，远程图已换成服务端代理地址），
//   以及纯文字（只有纯文字的信照原段落显示）。
// - GET /v2/mail-image?u=&e=&s= → 服务端代为加载远程图片（用户定：不用点、对方看不到他的 IP）。显示用的 iframe 是沙箱，
//   带不了会话 cookie，所以这条不要会话，凭服务端签的短期签名（HMAC，含网址和过期时间）。

import { Type, type Static } from 'typebox';
import { API_PREFIX, IdSchema, IsoTimeSchema } from './common.ts';
import { OrNull } from './lineage.ts';

export const MAIL_IMAGE_PATH = `${API_PREFIX}/mail-image`;

/** 聊天里一封邮件的抬头：标题和正文分开给（正文点开再取）。 */
export const ContactMailSchema = Type.Object({
  subject: Type.String(),
  fromName: OrNull(Type.String()),
  fromAddress: Type.String(),
  /** 有 HTML 正文（点开是 iframe）；没有就照纯文字的段落显示。 */
  html: Type.Boolean(),
  /** 附件名（附件本身不下载）。 */
  attachments: Type.Array(Type.String()),
});
export type ContactMail = Static<typeof ContactMailSchema>;

export const MailBodyResponseSchema = Type.Object({
  id: IdSchema,
  subject: Type.String(),
  fromName: OrNull(Type.String()),
  fromAddress: Type.String(),
  toAddress: OrNull(Type.String()),
  at: IsoTimeSchema,
  /** 清洗后的 HTML 片段，放进沙箱 iframe 的 srcdoc；只有纯文字的信是 null。 */
  html: OrNull(Type.String()),
  /** 纯文字正文（HTML 信是由 HTML 转出来的）。 */
  text: Type.String(),
  attachments: Type.Array(Type.String()),
});
export type MailBodyResponse = Static<typeof MailBodyResponseSchema>;

export const MailImageQuerySchema = Type.Object({
  u: Type.String({ minLength: 1, maxLength: 3_000 }),
  e: Type.String({ pattern: '^[0-9]{1,13}$' }),
  s: Type.String({ pattern: '^[A-Za-z0-9_-]{43}$' }),
});
export type MailImageQuery = Static<typeof MailImageQuerySchema>;
