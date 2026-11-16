import { Type } from 'typebox';
import type { MoneyDraftDesk } from './money-drafts.ts';
import type { PaymentReader } from './payment-reader.ts';
import { defineTool, type Tool } from '../tools/index.ts';

export function createPaymentTool(drafts: MoneyDraftDesk, reader: PaymentReader): Tool {
  return defineTool({
    name: 'propose_payment',
    label: '识别付款截图',
    replay: 'once',
    effect: 'internal',
    permission: 'auto',
    roles: ['conversation'],
    timeoutMs: 2000,
    description: '只有先看图认出给的图是付款截图才调。尊重他的拒绝，比如「这张图不要记账」；提到记账不等于要记。教程、普通照片、文字附件不调。系统在后台读：看得清的付款直接记下（新商家标出来以后再看），'
      + '只有金额读不清或已经记过的才出卡。attachmentId 用给的外部资料里的。',
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
