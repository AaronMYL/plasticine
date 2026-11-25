import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

const port = Number(process.env.PLASTICINE_PORT ?? '8790');
const token = process.env.PLASTICINE_LOCAL_TOKEN ?? '';
const session = `fake-${randomBytes(8).toString('hex')}`;
const delayMs = Number(process.env.FAKE_BODY_HEALTH_DELAY_MS ?? '2500');
const startedAt = Date.now();

const PAGE = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>假本机本体</title></head>
<body style="font:16px/1.6 system-ui;margin:48px">
<h1>假本机本体</h1><p id="session">…</p><p id="grant">…</p>
<script>
fetch('/v2/session').then((r) => { document.getElementById('session').textContent = r.ok ? '已登录' : '没登录'; });
(window.plasticineDesktop ? window.plasticineDesktop.server.localGrant() : Promise.resolve(null))
  .then((grant) => fetch('/__grant', { method: 'POST', body: grant === null ? '' : grant }))
  .then((r) => r.text()).then((text) => { document.getElementById('grant').textContent = text; });
</script></body></html>`;

function json(res: import('node:http').ServerResponse, status: number, body: unknown,
  headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(body));
}

const server = createServer((req, res) => {
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (chunk: string) => {
    body += chunk;
  });
  req.on('end', () => {
    const signedIn = (req.headers.cookie ?? '').includes(`plasticine_session=${session}`);
    if (req.url === '/v2/health') {
      json(res, Date.now() - startedAt >= delayMs ? 200 : 503, { ok: true });
    } else if (req.url === '/v2/account/state') {
      json(res, 200, { setup: 'done', handle: 'sample_user', displayName: '示例', passwordSet: true,
        networkUrl: null });
    } else if (req.url === '/v2/session/local' && req.method === 'POST') {
      const ok = token !== '' && req.headers['x-plasticine-local-token'] === token;
      json(res, ok ? 201 : 401, ok ? { ok: true } : { error: '本机令牌不对' }, ok ? { 'set-cookie':
        `plasticine_session=${session}; Path=/; Max-Age=3600; HttpOnly; SameSite=Strict` } : {});
    } else if (req.url === '/v2/session') {
      json(res, signedIn ? 200 : 401, {});
    } else if (req.url === '/__grant') {
      res.end(body === '' ? '界面没拿到本机令牌' : body === token ? '界面拿到的本机令牌对得上' : '本机令牌对不上');
    } else {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PAGE);
    }
  });
});
server.listen(port, '127.0.0.1');
process.stdin.resume();
process.stdin.on('end', () => {
  server.close();
  process.exit(0);
});
