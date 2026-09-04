#!/usr/bin/env python3
"""Tiny LAN helper for mimicTV.

Serves scripts/probe-library.sh as /probe.sh and accepts uploads to /upload/<name>,
saving them under data/imports/. Run from the repo root:

    python3 scripts/receive.py [port]

On the media box:
    curl -o /tmp/probe.sh http://<mac-ip>:8765/probe.sh
    bash /tmp/probe.sh -o /tmp/library.jsonl -u http://<mac-ip>:8765/upload
"""
import http.server, os, re, sys, time, socket

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, 'scripts', 'probe-library.sh')
IMPORTS = os.path.join(ROOT, 'data', 'imports')
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765


class Handler(http.server.BaseHTTPRequestHandler):
    def _send(self, code, body, ctype='text/plain'):
        data = body.encode() if isinstance(body, str) else body
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path in ('/probe.sh', '/probe-library.sh'):
            with open(SCRIPT, 'rb') as f:
                return self._send(200, f.read(), 'text/x-shellscript')
        if self.path == '/':
            return self._send(200, 'mimicTV receiver. GET /probe.sh, PUT /upload/<name>\n')
        self._send(404, 'not found\n')

    def do_PUT(self):
        m = re.match(r'^/upload/([^/]+)$', self.path)
        if not m:
            return self._send(404, 'use PUT /upload/<name>\n')
        name = re.sub(r'[^A-Za-z0-9._-]', '_', m.group(1)) or 'upload'
        length = int(self.headers.get('Content-Length') or 0)
        os.makedirs(IMPORTS, exist_ok=True)
        base, ext = os.path.splitext(name)
        if ext == '.gz':
            base, ext2 = os.path.splitext(base)
            ext = ext2 + ext
        stamp = time.strftime('%Y%m%d-%H%M%S')
        dest = os.path.join(IMPORTS, f'{base}-{stamp}{ext}')
        remaining, written = length, 0
        with open(dest, 'wb') as f:
            while remaining > 0:
                chunk = self.rfile.read(min(1 << 20, remaining))
                if not chunk:
                    break
                f.write(chunk)
                written += len(chunk)
                remaining -= len(chunk)
        print(f'received {written} bytes -> {dest}', flush=True)
        self._send(200, f'saved as {os.path.basename(dest)} ({written} bytes)\n')

    do_POST = do_PUT

    def log_message(self, fmt, *args):
        print(f'{self.address_string()} {fmt % args}', flush=True)


def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('10.255.255.255', 1))
        return s.getsockname()[0]
    except Exception:
        return '127.0.0.1'


if __name__ == '__main__':
    ip = lan_ip()
    print(f'mimicTV receiver on http://{ip}:{PORT}  (saving to {IMPORTS})')
    print(f'  curl -o /tmp/probe.sh http://{ip}:{PORT}/probe.sh && bash /tmp/probe.sh -o /tmp/library.jsonl -u http://{ip}:{PORT}/upload')
    http.server.ThreadingHTTPServer(('0.0.0.0', PORT), Handler).serve_forever()
