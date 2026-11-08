"""Local-only WebKit regression fixture: no external requests or persistent browser data."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
import json
import time


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        if self.path.startswith('/host'):
            body = f'<h1>宿主上下文</h1><iframe src="http://localhost:{child.server_port}/child"></iframe>'
        elif self.path.startswith('/child'):
            body = '''<p>跨域证据</p><textarea aria-label="跨域提问"></textarea>
            <p id="sent">发送次数：0</p><iframe src="/nested"></iframe>
            <script>let count=0;document.querySelector('textarea').onkeydown=(event)=>{
            if(event.key==='Enter') { count++;document.querySelector('#sent').textContent='发送次数：'+count; }
            };</script>'''
        else:
            body = '<p>嵌套证据</p><button type="button">嵌套按钮</button>'
        data = body.encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)


host = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
child = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
for server in (host, child):
    Thread(target=server.serve_forever, daemon=True).start()
print(json.dumps({'url': f'http://127.0.0.1:{host.server_port}/host'}), flush=True)
try:
    while True:
        time.sleep(1)
finally:
    for server in (host, child):
        server.shutdown()
