// 有副作用的请求都带客户端生成的稳定标识（《实施方案》第 5 节约定 1）：重发用同一个，服务端不重跑。

export function createRequestId(): string {
  return `req_${crypto.randomUUID()}`;
}
