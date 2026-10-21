# Tasarım Masası yerel sunucusu (http://localhost:5199/).
# Python'un düz http.server'ı önbellek başlığı göndermiyor; tarayıcı eski sayfayı
# kendi kendine saklıyor ve yapılan değişiklik görünmüyordu (24.09). Bu sürüm her
# yanıta "no-store" ekler. Çalıştırma (cmd):  python sunucu.py
import http.server, os, socket, socketserver

os.chdir(os.path.dirname(os.path.abspath(__file__)))

class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        super().end_headers()
    def log_message(self, *a):
        pass

class S(socketserver.ThreadingMixIn, http.server.HTTPServer):
    # IPv6 + IPv4 birlikte: yalnız IPv4 dinlenince tarayıcı "localhost" için önce ::1'i deniyor,
    # her istekte ~0,3 sn kaybediyor ve bazı betikler "fetch" hatasıyla düşüyordu (24.09 ölçüldü).
    address_family = socket.AF_INET6
    daemon_threads = True
    allow_reuse_address = True
    def server_bind(self):
        self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        super().server_bind()

S(("::", 5199), H).serve_forever()
