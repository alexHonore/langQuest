# Static server for an Expo web "single" export: unknown paths fall back to index.html (client routing).
import http.server, os, sys
root = sys.argv[1]; port = int(sys.argv[2])
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=root, **k)
    def send_head(self):
        p = self.translate_path(self.path)
        if not os.path.exists(p):
            self.path = '/index.html'
        return super().send_head()
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(('127.0.0.1', port), H).serve_forever()
