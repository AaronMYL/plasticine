import type { StateService } from '../state/index.ts';

/** 以发件箱真实回执结算；群消息要等所有初始收件人，不以第一个回执冒充全员收到。 */
export function settleNetworkOutbound(state: Pick<StateService, 'contactMessages' | 'outboundLog'>,
  taskId: string): void {
  const sourceRef = `network-task:${taskId}`;
  const logs = state.outboundLog.bySource(sourceRef);
  if (logs.length === 0) { return; }
  const messages = state.contactMessages.forTask(taskId).filter((message) => message.direction === 'out'
    && (message.kind === 'task_offer' || message.kind === 'group_task'
      && typeof message.payload === 'object' && message.payload !== null
      && Reflect.get(message.payload, 'op') === 'offer'));
  if (messages.length === 0 || messages.some((message) => message.status === 'sending')) { return; }
  const failed = messages.filter((message) => message.status === 'failed').length;
  const status = failed === 0 ? 'sent' : failed === messages.length ? 'failed' : 'unknown';
  const summary = failed === 0 ? '中继已接收发给全部对象的任务卡；这不代表对方已阅读。'
    : failed === messages.length ? '发件箱确认任务卡发送失败。' : '部分对象发送失败，请逐个核对联系人消息记录。';
  for (const log of logs) { state.outboundLog.finish(log.id, { status, summary, sourceRef }); }
}
