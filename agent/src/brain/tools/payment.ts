import { Type } from 'typebox';
import type { MoneyDraftDesk } from '../../life/index.ts';
import type { PaymentReader } from '../payment-reader.ts';
import { defineTool, type Tool } from './registry.ts';

export function createPaymentTool(drafts: MoneyDraftDesk, reader: PaymentReader): Tool {
  return defineTool({
    name: 'propose_payment',
    label: '识别付款截图',
    replay: 'once',
    effect: 'internal',
    permission: 'auto',
    roles: ['conversation'],
    timeoutMs: 2000,
    description:
      'Call only after visually identifying a supplied image as a payment screenshot. ' +
      'Respect user refusals such as “这张图不要记账”; mentioning bookkeeping is not a request. ' +
      'Do not call for tutorials, ordinary photos or text attachments. The system reads it in the background: ' +
      'a clearly readable payment is recorded directly (a new merchant is marked for a later look), and only an ' +
      'unreadable amount or an already recorded payment raises a card. Use attachmentId from the supplied ' +
      'external material.',
    parameters: Type.Object({ attachmentId: Type.String({ minLength: 1 }), isPaymentScreenshot: Type.Literal(true) },
      { additionalProperties: false }),
    async execute(args, context) {
      if (context.actionId === null) {
        throw new Error('识别付款截图需要稳定动作标识。');
      }
      const row = drafts.request(
        { requestId: `payment:${context.actionId}`, attachmentId: args.attachmentId, messageId: null },
      );
      reader.start(row.id);
      return JSON.stringify({ id: row.id, status: row.status, askId: row.askId });
    },
  });
}
