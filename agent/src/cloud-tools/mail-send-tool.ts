import { Type } from 'typebox';
import { defineTool, ToolFailure, ToolUncertain, type Tool } from '../tools/index.ts';
import { CloudToolError } from './errors.ts';
import type { MailSender } from './mail.ts';

export const MAIL_CHANNEL = 'mail:gmail';
export const MAIL_ATTACHMENTS_MAX_BYTES = 18 * 1024 * 1024;
const MAIL_ATTACHMENTS_MAX = 10;
const SEND_TIMEOUT_MS = 90_000;

const Address = Type.String({ minLength: 3, maxLength: 254 });

const Parameters = Type.Object({
  to: Type.Array(Address, { minItems: 1, maxItems: 20, uniqueItems: true }),
  cc: Type.Optional(Type.Array(Address, { maxItems: 20, uniqueItems: true })),
  bcc: Type.Optional(Type.Array(Address, { maxItems: 20, uniqueItems: true })),
  subject: Type.String({ minLength: 1, maxLength: 200 }),
  text: Type.String({ minLength: 1, maxLength: 50_000, description: '正文（纯文字）。' }),
  attachments: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 1_000 }), {
    maxItems: MAIL_ATTACHMENTS_MAX, uniqueItems: true, description: '文件页里的文件路径。' })),
}, { additionalProperties: false });

export interface MailSendPorts {
  sender: MailSender;
  readFile(path: string): { name: string; type: string; data: Buffer };
}

export function createMailSendTool(ports: MailSendPorts): Tool {
  return defineTool({
    name: 'mail_send',
    label: '发邮件',
    description: '用他配好的 Gmail 以他的名义发一封邮件：收件人、抄送、密送都能几个，附件写文件页里的路径（一共 18 MB 内）。'
      + '发出去撤不回：他的承诺和授权覆盖就直接发，不覆盖他会收到一张卡确认这一整件事。给他自己提醒不用它。',
    replay: 'once',
    effect: 'external',
    permission: 'agreement',
    roles: ['conversation', 'worker'],
    timeoutMs: SEND_TIMEOUT_MS,
    parameters: Parameters,
    outbound: (args) => ({ channel: MAIL_CHANNEL, account: MAIL_CHANNEL,
      recipients: [...new Set([...args.to, ...(args.cc ?? []), ...(args.bcc ?? [])].map((address) =>
        address.trim().toLowerCase()))],
      category: 'message', content: `${args.subject.trim()}\n\n${args.text.trim()}` }),
    async execute(args, context) {
      if (!ports.sender.configured()) {
        throw new ToolFailure('还没配发信的邮箱：请他在「设置 · 连接」里连上 Gmail（应用专用密码）再发。');
      }
      const attachments = (args.attachments ?? []).map((path) => ports.readFile(path));
      const bytes = attachments.reduce((sum, file) => sum + file.data.length, 0);
      if (bytes > MAIL_ATTACHMENTS_MAX_BYTES) {
        throw new ToolFailure('附件一共超过 18 MB，Gmail 发不出去：少带几个，或者先压小（image_edit 调 quality）。');
      }
      const [first, ...moreTo] = args.to;
      try {
        await ports.sender.send({ to: first ?? '', moreTo, cc: args.cc ?? [], bcc: args.bcc ?? [],
          subject: args.subject, text: args.text, inReplyTo: null, attachments }, context.signal);
      } catch (cause) {
        if (cause instanceof CloudToolError && cause.code === 'unknown') throw new ToolUncertain(cause.message);
        if (cause instanceof CloudToolError) throw new ToolFailure(cause.message);
        throw cause;
      }
      return JSON.stringify({ sent: true, to: args.to, cc: args.cc ?? [], attachments: attachments.map((file) =>
        file.name) });
    },
  });
}
