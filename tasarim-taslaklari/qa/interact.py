# -*- coding: utf-8 -*-
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
from playwright.sync_api import sync_playwright

errors = []
cur = {"ctx": "boot"}

def login(pg, role):
    pg.evaluate("""(role)=>{ const H=window.H; const u=H.units().map(x=>x.id);
        H.state.realUser=null; H.state.user={name:'QA',u:'qa',role,units:u,extras:[],active:true,title:''}; H.renderApp(); }""", role)

def nav(pg, page, params):
    pg.evaluate("""(a)=>{ try{ window.H.closeModal&&window.H.closeModal(); window.H.go(a[0], a[1]||{}); }catch(e){} }""", [page, params])
    pg.wait_for_timeout(120)

def click_all_btns(pg, label):
    # .content içindeki butonları teker teker tıkla; her tıklamadan sonra modalı kapat, ekrana geri dön
    n = pg.evaluate("""()=> document.querySelectorAll('.content .btn, .content [data-stab], .content .seg button, .content [data-rf], .content [data-vztab]').length""")
    for i in range(min(n, 60)):
        cur["ctx"] = label + " #btn" + str(i)
        pg.evaluate("""(i)=>{ const els=document.querySelectorAll('.content .btn, .content [data-stab], .content .seg button, .content [data-rf], .content [data-vztab]');
            const el=els[i]; if(el){ try{ el.click(); }catch(e){} } }""", i)
        pg.wait_for_timeout(70)
        pg.evaluate("""()=>{ try{ window.H.closeModal&&window.H.closeModal(); }catch(e){} }""")

def click_first_rows(pg, label):
    # ilk birkaç tıklanabilir satırı aç (detay/kart)
    for sel in ['[data-set]', '[data-load]', '[data-kart]', '[data-alet]', '[data-talep-onay]',
                '[data-rid]', '[data-pid]', '[data-persedit]', '[data-usdetay]', '[data-rndopen]', '[data-vzhasta]']:
        cur["ctx"] = label + " row " + sel
        pg.evaluate("""(sel)=>{ const el=document.querySelector('.content '+sel); if(el){ try{ el.click(); }catch(e){} } }""", sel)
        pg.wait_for_timeout(90)
        pg.evaluate("""()=>{ try{ window.H.closeModal&&window.H.closeModal(); }catch(e){} }""")

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page()
    pg.on("console", lambda m: errors.append((cur["ctx"], m.type, m.text)) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errors.append((cur["ctx"], "pageerror", str(e))))
    pg.on("dialog", lambda d: d.dismiss())
    pg.goto("http://localhost:5180/app/?hizli=1", wait_until="networkidle")
    pg.wait_for_timeout(600)
    login(pg, "sistem")
    pid = pg.evaluate("()=> (H.data.patients&&H.data.patients[0]&&H.data.patients[0].id)||null")

    STER_TABS = ["pano","depo","yukler","arabalar","talepler","tanim","aletler","komuta"]
    VZ_TABS = ["giris","fatura","fiyat","kurumsal","indirim","iade","gfk","evrak"]

    plan = [
        ("msu", "sterilizasyon", [{"tab":t} for t in STER_TABS]),
        ("kabul", "vezne", [{"tab":t} for t in VZ_TABS]),
        ("sistem", "ik", [{}]),
        ("kabul", "randevu", [{"view":"liste"},{"view":"takvim"},{"view":"hafta"}]),
        ("yonetici", "medmuhasebe", [{}]),
        ("yonetici", "raporlar", [{}]),
        ("hekim", "hasta360", [{"pid":pid}]),
        ("laborant", "labislem", [{"tur":"lab"},{"tur":"rad"},{"tur":"kan"}]),
        ("hekim", "istakip", [{}]),
        ("sistem", "admin", [{"tab":"users"},{"tab":"roles"},{"tab":"fiyat"},{"tab":"ptip"},{"tab":"bolumliste"}]),
        ("hekim", "patient", [{"pid":pid,"tab":"istem"}]),
    ]
    for role, page, paramlist in plan:
        login(pg, role)
        for prm in paramlist:
            label = role + "/" + page + "/" + str(prm)
            nav(pg, page, prm)
            click_all_btns(pg, label)
            click_first_rows(pg, label)
            nav(pg, page, prm)  # reset

    b.close()

print("=== FAZ 2 HATALAR (%d) ===" % len(errors))
seen = set()
for ctx, typ, txt in errors:
    key = (typ, (txt or "")[:100])
    if key in seen:
        continue
    seen.add(key)
    print("[%s] %s :: %s" % (typ, ctx, (txt or "")[:220]))
if not errors:
    print("(temiz — hata yok)")
