import { createServer, type Server } from 'node:http';

export const CAPTURE_TIMEOUT_MAX_MS = 15 * 60_000;

const DONE_PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>已完成 · Plasticine</title>
<style>
:root{color-scheme:light dark;--bg:#faf8f4;--fg:#1f1d1a;--fg2:#5a534b}
@media (prefers-color-scheme: dark){:root{--bg:#1c1b19;--fg:#f2efea;--fg2:#bdb6ac}}
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
