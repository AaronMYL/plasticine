// 给测试和本地开发造故障：下一次某个操作回执丢失（结果待核实）或明确失败。
// 回执丢失分两种：请求其实已经落地（landed）和根本没到服务端，核实时结果不同。

import { ApiError, uncertainError } from '../errors.ts';

export type FaultOperation =
  | 'improvement'
  | 'backup'
  | 'send'
  | 'save'
  | 'create'
  | 'remove'
  | 'get'
  | 'lookup'
  | 'answerWidget'
  | 'command'
  | 'answer'
  | 'ask_feedback'
  | 'defer'
  | 'push'
  | 'cognition'
  | 'judgment_status'
  | 'signed'
  | 'register_key'
  | 'concern'
  | 'project'
  | 'brief_read'
  | 'brief_seen'
  | 'brief_difference'
  | 'daily_settings'
  | 'feed'
  | 'node'
  | 'device_read'
  | 'money'
  | 'focus'
  | 'reminder'
  | 'inbox'
  | 'files'
  | 'artifact'
  | 'browser'
  | 'bookmark'
  | 'contacts'
  | 'network'
  | 'visibility';

export type Fault =
  | { kind: 'uncertain'; landed: boolean }
  | { kind: 'failed'; message: string };

export class FaultPlan {
  private readonly pending = new Map<FaultOperation, Fault>();

  next(operation: FaultOperation, fault: Fault): void {
    this.pending.set(operation, fault);
  }

  /** 取出并清掉这次操作的故障；没有就返回 undefined。 */
  take(operation: FaultOperation): Fault | undefined {
    const fault = this.pending.get(operation);
    this.pending.delete(operation);
    return fault;
  }
}

export function faultError(operation: FaultOperation, fault: Fault): ApiError {
  if (fault.kind === 'uncertain') {
    return uncertainError(OPERATION_LABELS[operation]);
  }
  return new ApiError({ kind: 'failed', code: 'fake_failure', message: fault.message });
}

const OPERATION_LABELS: Record<FaultOperation, string> = {
  bookmark: '书签',
  improvement: '改进发现',
  backup: '本机备份',
  cognition: '保存认知页改动',
  send: '发送',
  save: '保存笔记',
  create: '新建笔记',
  remove: '删除笔记',
  get: '读笔记',
  lookup: '核实',
  answerWidget: '作答',
  command: '任务命令',
  answer: '作答',
  ask_feedback: '问题反馈',
  defer: '先不',
  push: '登记系统通知',
  judgment_status: '改判断状态',
  signed: '签名操作',
  register_key: '登记签名钥匙',
  concern: '改关切',
  project: '改项目',
  brief_read: '回来汇报',
  brief_seen: '十件事看过',
  brief_difference: '记这条变化的差异',
  daily_settings: '存今日设置',
  feed: '信息流',
  node: '节点操作',
  device_read: '读设备与度量',
  money: '记账',
  focus: '专注',
  reminder: '提醒',
  inbox: '站内信',
  files: '文件',
  artifact: '成果',
  browser: '浏览器操作',
  contacts: '联系人',
  network: '网络账号',
  visibility: '对外可见',
};
