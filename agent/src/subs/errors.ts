// subs/ 的错误：invalid 是写进来的东西不合规（正文、设置），conflict 是现在的状态不允许（没出过样刊就开定时）。
// app/ 按代码回 400 / 409，工具把 message 原样交给模型。

export type SubsErrorCode = 'invalid' | 'conflict' | 'not_found';

export class SubsError extends Error {
  readonly code: SubsErrorCode;

  constructor(code: SubsErrorCode, message: string) {
    super(message);
    this.name = 'SubsError';
    this.code = code;
  }
}
