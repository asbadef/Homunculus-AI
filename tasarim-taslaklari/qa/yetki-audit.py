# -*- coding: utf-8 -*-
# Rol × ekran yetki taraması: her rol için sol menüde (NAV) GÖRÜNEN ekranları
# gerçek railHtml çıktısından okur. Dar destek rollerinin klinik/yönetim ekranı
# görmesi (yetki sızıntısı) olası ANOMALİ olarak işaretlenir.
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
from playwright.sync_api import sync_playwright

# Klinik/hasta-veri taşıyan ekranlar: hasta adı görmeyen (names:false) roller bunları görmemeli.
CLINICAL = {"beds", "drislem", "gelisler", "wall", "unitdash", "tasks", "bedside",
            "alarms", "hand", "yatanlar", "patient", "hasta360", "pharmacy", "rrt", "numune"}
# names:false roller (klinik hasta bilgisi görmemeli) — core.js H.data.roles'tan.
# sistem hariç: Ozan kararı "admin'de tüm roller açık" (shell.js:284), kasıtlı süper-kullanıcı.
NAMES_FALSE = {"biyomed", "yonetici", "kalite", "msu"}

PORT = sys.argv[1] if len(sys.argv) > 1 else "8099"

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page()
    pg.goto("http://127.0.0.1:%s/app/index.html?hizli=1" % PORT, wait_until="networkidle")
    pg.wait_for_timeout(500)
    roles = pg.evaluate("() => Object.keys(H.data.roles)")
    matrix = {}
    for role in roles:
        navs = pg.evaluate("""(role) => {
            const H = window.H; H.state.realUser = null;
            H.state.user = { name:'A '+role, u:'a', role, units:H.units().map(x=>x.id), extras:[], active:true, title:'' };
            H.renderApp && H.renderApp();
            const set = new Set();
            document.querySelectorAll('.rail [data-nav], nav [data-nav], [data-nav]').forEach(el => {
                const k = el.getAttribute('data-nav'); if (k && k!=='settings') set.add(k);
            });
            return [...set];
        }""", role)
        matrix[role] = sorted(navs)

    print("=== ROL × GÖRÜNEN EKRAN (NAV) ===")
    for role in roles:
        print("%-11s: %s" % (role, ", ".join(matrix[role]) or "—"))

    print("\n=== OLASI SIZINTI (names:false rol klinik ekran görüyor) ===")
    leaks = []
    for role in NAMES_FALSE:
        for scr in matrix.get(role, []):
            if scr in CLINICAL:
                leaks.append((role, scr))
                print("  [!] %s → %s" % (role, scr))
    if not leaks:
        print("  (sızıntı yok)")
    b.close()
