# -*- coding: utf-8 -*-
import sys, io, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
from playwright.sync_api import sync_playwright

errors = []   # (ctx, type, text)
cur = {"ctx": "boot"}

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page()
    pg.on("console", lambda m: errors.append((cur["ctx"], m.type, m.text)) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errors.append((cur["ctx"], "pageerror", str(e))))
    pg.goto("http://localhost:5180/app/?hizli=1", wait_until="networkidle")
    pg.wait_for_timeout(700)

    # sistem olarak zorla giriş
    pg.evaluate("""() => {
        const H = window.H; H.state.realUser = null;
        const units = H.units().map(x => x.id);
        H.state.user = { name:'QA', u:'qa', role:'sistem', units, extras:[], active:true, title:'QA' };
        H.renderApp && H.renderApp();
    }""")
    pg.wait_for_timeout(400)

    info = pg.evaluate("""() => ({
        roles: Object.keys(H.data.roles),
        pages: Object.keys(H.pages),
        pid: (H.data.patients && H.data.patients[0] && H.data.patients[0].id) || null
    })""")
    roles = info["roles"]; pages = info["pages"]; pid = info["pid"]
    print("ROLLER:", roles)
    print("EKRANLAR:", len(pages), pages)
    print("---")

    # pid gerektiren ekranlar için paramlar
    def params_for(pagek):
        if pagek in ("patient", "hasta360", "bedside"):
            return {"pid": pid, "tab": "ozet"}
        if pagek == "sterilizasyon":
            return {"tab": "pano"}
        return {}

    for role in roles:
        cur["ctx"] = "SET-ROLE " + role
        ok = pg.evaluate("""(role) => {
            try {
              const H = window.H; const units = H.units().map(x => x.id);
              H.state.realUser = null;
              H.state.user = { name:'QA '+role, u:'qa', role, units, extras:[], active:true, title:'QA' };
              H.renderApp && H.renderApp();
              return true;
            } catch(e){ return 'ERR '+e.message; }
        }""", role)
        pg.wait_for_timeout(120)
        if ok is not True:
            errors.append(("SET-ROLE " + role, "evalerr", str(ok)))
            continue
        for pagek in pages:
            cur["ctx"] = role + " / " + pagek
            res = pg.evaluate("""(args) => {
                const [pagek, prm] = args;
                try {
                  window.H.go(pagek, prm || {});
                  const c = document.querySelector('.content');
                  const h2 = c && c.querySelector('h2');
                  return { ok:true, h2: h2 ? h2.textContent.slice(0,40) : '(h2 yok)', len: c ? c.innerText.length : 0 };
                } catch(e){ return { ok:false, err:e.message }; }
            }""", [pagek, params_for(pagek)])
            pg.wait_for_timeout(90)
            if not res.get("ok"):
                errors.append((role + " / " + pagek, "go-throw", res.get("err")))
            elif res.get("len", 0) < 5:
                errors.append((role + " / " + pagek, "bos-ekran", "icerik yok (len=%s, h2=%s)" % (res.get("len"), res.get("h2"))))

    b.close()

print("=== HATALAR (%d) ===" % len(errors))
seen = set()
for ctx, typ, txt in errors:
    key = (typ, (txt or "")[:120])
    tag = "" if key not in seen else "  [tekrar]"
    seen.add(key)
    print("[%s] %s :: %s%s" % (typ, ctx, (txt or "")[:200], tag))
if not errors:
    print("(temiz — hata yok)")
