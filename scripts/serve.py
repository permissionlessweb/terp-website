#!/usr/bin/env python3
"""Dev server with clean URL routing matching nginx config."""
import http.server
import os
import urllib.request
import urllib.error

PORT = int(os.environ.get("WEBSITE_PORT", "3000"))
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__),'..'))
print(f"ROOT = {ROOT}")
print(f"pages dir exists: {os.path.isdir(os.path.join(ROOT, 'pages'))}")
if os.path.isdir(os.path.join(ROOT, 'pages')):
    print(f"pages contents: {os.listdir(os.path.join(ROOT, 'pages'))}")
RPC_PROXY = os.environ.get("CHAIN_RPC", "http://localhost:26657")  # proxied at /rpc to avoid CORS in dev

# Auto-discover routes from pages/*.html
# /mint -> pages/mint.html, /no-rick -> pages/no-rick.html, etc.
ROUTES = {}
_pages_dir = os.path.join(ROOT, "pages")
if os.path.isdir(_pages_dir):
    for f in os.listdir(_pages_dir):
        if f.endswith(".html") and f != "index.html":
            slug = "/" + f[:-5]  # strip .html -> /mint, /no-rick, etc.
            ROUTES[slug] = f

# Suppress noisy auto-requests that are never meaningful in dev
SILENT_404 = {
    "/.well-known/appspecific/com.chrome.devtools.json",
}

_HOP_HEADERS = {"host", "transfer-encoding", "content-length"}


def _proxy_rpc(handler, method):
    """Forward /rpc[/path][?query] → RPC_PROXY[/path][?query]."""
    suffix = handler.path[4:]  # strip /rpc prefix
    url = RPC_PROXY + (suffix or "/")
    length = int(handler.headers.get("Content-Length", 0))
    body = handler.rfile.read(length) if length else None
    req = urllib.request.Request(url, data=body, method=method)
    for k, v in handler.headers.items():
        if k.lower() not in _HOP_HEADERS:
            req.add_unredirected_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            handler.send_response(r.status)
            for k, v in r.headers.items():
                if k.lower() not in _HOP_HEADERS:
                    handler.send_header(k, v)
            handler.send_header("Content-Length", str(len(raw)))
            handler.end_headers()
            handler.wfile.write(raw)
    except urllib.error.HTTPError as e:
        raw = e.read()
        handler.send_response(e.code)
        handler.send_header("Content-Type", "application/json")
        handler.send_header("Content-Length", str(len(raw)))
        handler.end_headers()
        handler.wfile.write(raw)
    except Exception as exc:
        handler.send_error(502, f"RPC proxy: {exc}")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def _is_rpc(self):
        return self.path == "/rpc" or self.path.startswith(("/rpc/", "/rpc?"))

    def do_GET(self):
        if self._is_rpc():
            _proxy_rpc(self, "GET")
            return
        # Silence known browser noise with a quiet 204
        if self.path in SILENT_404:
            self.send_response(204)
            self.end_headers()
            return
        # Strip query string for routing
        clean = self.path.split("?")[0]
        # Clean-URL routing: /mint -> pages/mint.html
        if clean in ROUTES:
            self.path = "/pages/" + ROUTES[clean]
        elif clean == "/":
            self.path = "/pages/index.html"
        # Direct .html requests: /foo.html -> /pages/foo.html
        elif clean.endswith(".html") and not clean.startswith("/pages/"):
            self.path = "/pages" + clean
        super().do_GET()

    def do_POST(self):
        if self._is_rpc():
            _proxy_rpc(self, "POST")
            return
        self.send_error(405)

    def guess_type(self, path):
        if path.endswith(".wasm"):
            return "application/wasm"
        if path.endswith(".js"):
            return "application/javascript; charset=utf-8"
        return super().guess_type(path)

    def end_headers(self):
        # Disable caching for HTML so changes are always picked up immediately
        if self.path.endswith(".html"):
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.send_header("Pragma", "no-cache")
        super().end_headers()

    def log_message(self, format, *args):
        # Suppress 204 responses from the silent-404 list to keep output clean
        if args and str(args[1]) == "204":
            return
        super().log_message(format, *args)


print(f"Serving at http://localhost:{PORT}")
print(f"  http://localhost:{PORT}/       -> index.html")
for slug in sorted(ROUTES):
    print(f"  http://localhost:{PORT}{slug:<10} -> {ROUTES[slug]}")
print(f"  http://localhost:{PORT}/rpc    -> {RPC_PROXY}  (CORS proxy)")
http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
