#!/bin/sh
# Serves the site folder next to this script to the browser on this computer only, so the app can run
# with no internet. It needs python3, which macOS and most Linux systems already have. It makes no
# outside connection, writes no file and changes no setting. Stop it with Ctrl+C.
#
#   start.sh [--no-open] [--port N]
#
# Exit codes: 0 stopped, 2 no free port (or the one asked for is taken), 3 the site folder is missing,
# 4 python3 is missing.

here=$(cd "$(dirname "$0")" && pwd)

if [ ! -d "$here/site" ]; then
  echo "The 'site' folder was not found next to this script. Unzip the whole release and run this again."
  exit 3
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 was not found. On Windows use start.cmd instead. Otherwise install Python 3, or use the hosted site."
  exit 4
fi

exec python3 - "$here/site" "$@" <<'PY'
import http.server, os, socketserver, sys, threading, webbrowser

root = os.path.realpath(sys.argv[1])
args = sys.argv[2:]
no_open = "--no-open" in args
wanted = int(args[args.index("--port") + 1]) if "--port" in args else 0

TYPES = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".json": "application/json", ".wasm": "application/wasm", ".png": "image/png",
    ".svg": "image/svg+xml", ".woff": "font/woff", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".ico": "image/x-icon",
}


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _send(self, code, body=b"", ctype="text/plain; charset=utf-8", extra=None, head=False):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Connection", "close")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if not head:
            self.wfile.write(body)

    def _serve(self, head):
        from urllib.parse import unquote, urlsplit
        path = unquote(urlsplit(self.path).path)
        if path == "/":
            return self._send(302, extra={"Location": "/APP-synthetic-data-generator/"}, head=head)
        if "\\" in path or "\x00" in path or ".." in path.split("/"):
            return self._send(404, b"Not found", head=head)
        full = os.path.realpath(os.path.join(root, *path.strip("/").split("/")))
        if os.path.isdir(full):
            full = os.path.join(full, "index.html")
        if not (full == root or full.startswith(root + os.sep)) or not os.path.isfile(full):
            return self._send(404, b"Not found", head=head)
        with open(full, "rb") as f:
            data = f.read()
        self._send(200, data, TYPES.get(os.path.splitext(full)[1].lower(), "application/octet-stream"), head=head)

    def do_GET(self):
        self._serve(False)

    def do_HEAD(self):
        self._serve(True)

    def _refuse(self):
        self._send(405, b"Method not allowed", extra={"Allow": "GET, HEAD"})

    do_POST = do_PUT = do_DELETE = do_PATCH = do_OPTIONS = _refuse


class Server(http.server.ThreadingHTTPServer):
    allow_reuse_address = False
    daemon_threads = True

    def server_bind(self):
        # The standard server looks up the host name of the address it binds, a reverse DNS query. With no
        # internet (this release's whole purpose) that can stall for a long time, so it is skipped.
        socketserver.TCPServer.server_bind(self)
        self.server_name = "127.0.0.1"
        self.server_port = self.server_address[1]


server = None
port = 0
for p in ([wanted] if wanted else range(8731, 8801)):
    try:
        server = Server(("127.0.0.1", p), Handler)
        port = p
        break
    except OSError:
        continue
if server is None:
    print("No free port was found (or the port asked for is in use). Close the other copy and run this again.")
    sys.exit(2)

url = "http://127.0.0.1:%d/APP-synthetic-data-generator/" % port
print("URL: " + url, flush=True)
print("Serving this folder on this computer only. Nothing is sent anywhere.", flush=True)
print("Press Ctrl+C to stop.", flush=True)
if not no_open:
    threading.Timer(0.3, lambda: webbrowser.open(url)).start()
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
PY
