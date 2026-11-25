export class ToolFailure extends Error {
  readonly content: string;

  constructor(content: string) {
    super('工具返回失败结果');
    this.name = 'ToolFailure';
    this.content = content;
  }
}

export class ToolUncertain extends ToolFailure {}
