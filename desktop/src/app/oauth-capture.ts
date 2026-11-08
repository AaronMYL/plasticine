// 在这台电脑上等一次 OAuth 回调（bridge 的 external.capture，11-08）：模型订阅登录在系统浏览器里做完，浏览器跳回
// http://localhost:<port>/…；连远程实例时这个 localhost 是这台电脑，本体收不到，由壳在 127.0.0.1:<port> 上临时听一次，
// 收到第一个请求就把完整地址交给界面（界面再交给本体已有的「贴回调地址」接口），给浏览器回一页「已完成」，关掉监听。
// 超时、取消、端口被占都回 null。同一时间只有一个：新的一次先把旧的结束掉（回 null）。回调地址带授权码，不进日志。

import { createServer, type Server } from 'node:http';

/** 最长等这么久（界面给的更长也按这个）：订阅登录要输密码、过两步验证，一刻钟够了。 */
export const CAPTURE_TIMEOUT_MAX_MS = 15 * 60_000;

const DONE_PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>已完成 · Plasticine</title>
<style>
:root{color-scheme:light dark;--bg:#fcf9f6;--fg:#2a2622;--fg2:#6b635b}
@media (prefers-color-scheme: dark){:root{--bg:#2b2826;--fg:#f5f1ec;--fg2:#b8b0a7}}
html,body{margin:0;height:100%;background:var(--bg);color:var(--fg);
font:14px/22px Geist,'PingFang SC',MiSans,'Microsoft YaHei',system-ui,sans-serif}
body{display:flex;align-items:center;justify-content:center}
main{display:flex;flex-direction:column;gap:8px;padding:24px}
h1{font-size:24px;line-height:32px;font-weight:600;margin:0}
p{margin:0;color:var(--fg2)}
</style></head>
<body><main><h1>已完成</h1><p>可以关掉这一页，回到 Plasticine。</p></main></body></html>
`;

interface Active {
  finish(value: string | null): void;
}

export class OAuthCapture {
  private readonly log: (line: string) => void;
  private active: Active | null = null;

  constructor(log: (line: string) => void) {
    this.log = log;
  }

  capture(port: number, timeoutMs: number): Promise<string | null> {
    this.cancel();
    return new Promise((resolve) => {
      const server: Server = createServer();
      let done = false;
      const finish = (value: string | null): void => {
        if (done) {
          return;
        }
        done = true;
        clearTimeout(timer);
        if (this.active === active) {
          this.active = null;
        }
        server.close();
        server.closeIdleConnections();
        resolve(value);
      };
      const timer = setTimeout(() => finish(null), Math.min(timeoutMs, CAPTURE_TIMEOUT_MAX_MS));
      const active: Active = { finish };
      this.active = active;
      server.on('request', (request, response) => {
        if (done) {
          response.writeHead(410, { connection: 'close' }).end();
          return;
        }
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
          connection: 'close' });
        response.end(DONE_PAGE);
        finish(`http://localhost:${port}${request.url ?? '/'}`);
      });
      server.on('error', (error: NodeJS.ErrnoException) => {
        this.log(error.code === 'EADDRINUSE'
          ? `等登录回调没开成：端口 ${port} 被别的程序占着。`
          : `等登录回调没开成（端口 ${port}）：${error.message}`);
        finish(null);
      });
      server.listen(port, '127.0.0.1');
    });
  }

  cancel(): void {
    this.active?.finish(null);
  }
}
