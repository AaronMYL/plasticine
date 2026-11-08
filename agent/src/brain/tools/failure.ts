/** 已完成调用的业务失败；可接服务明确标记的业务原因，不能包装未分类的异常原文。 */
export class ToolFailure extends Error {
  readonly content: string;

  constructor(content: string) {
    super('工具返回失败结果');
    this.name = 'ToolFailure';
    this.content = content;
  }
}

/** 已发出的动作失去回执或控制权，不能把它作为「明确没做」重试。只接受调用方的固定提示。 */
export class ToolUncertain extends ToolFailure {}
