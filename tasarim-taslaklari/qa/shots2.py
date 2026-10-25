# -*- coding: utf-8 -*-
import sys, io, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
from playwright.sync_api import sync_playwright
OUT = r"C:\Users\OZANSU~1\AppData\Local\Temp\claude\c--Dev-Projeler-Homunculus\2d38e891-b823-4435-8eb7-0a01ee547316\scratchpad\shots2"
os.makedirs(OUT, exist_ok=True)

def shot(pg, name): pg.wait_for_timeout(350); pg.screenshot(path=OUT+"\\"+name+".png", full_page=False)
def login(pg, role): pg.evaluate("""(role)=>{const H=window.H;const u=H.units().map(x=>x.id);H.state.realUser=null;H.state.user={name:'QA',u:'qa',role,units:u,extras:[],active:true,title:''};H.renderApp();}""", role)
def go(pg, page, prm): pg.evaluate("(a)=>{window.H.closeModal&&window.H.closeModal();window.H.go(a[0],a[1]||{});}", [page, prm])

with sync_playwright() as p:
    b = p.chromium.launch(headless=True); pg = b.new_page(viewport={"width":1500,"height":900})
    pg.on("dialog", lambda d: d.dismiss())
    pg.goto("http://localhost:5180/app/?hizli=1", wait_until="networkidle"); pg.wait_for_timeout(600)
    login(pg, "kabul")
    for t in ["giris","fatura","kurumsal","gfk"]:
        go(pg, "vezne", {"tab":t}); shot(pg, "vezne_"+t)
    for v in ["liste","takvim","hafta"]:
        go(pg, "randevu", {"view":v}); shot(pg, "randevu_"+v)
    login(pg, "sistem")
    go(pg, "ik", {}); shot(pg, "ik")
    b.close()
print("OK")
