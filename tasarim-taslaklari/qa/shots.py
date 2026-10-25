# -*- coding: utf-8 -*-
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
from playwright.sync_api import sync_playwright
OUT = r"C:\Users\OZANSU~1\AppData\Local\Temp\claude\c--Dev-Projeler-Homunculus\2d38e891-b823-4435-8eb7-0a01ee547316\scratchpad\shots"
import os; os.makedirs(OUT, exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page(viewport={"width":1500,"height":900})
    pg.on("dialog", lambda d: d.dismiss())
    pg.goto("http://localhost:5180/app/?hizli=1", wait_until="networkidle"); pg.wait_for_timeout(600)
    pg.evaluate("""()=>{ const H=window.H; const u=H.units().map(x=>x.id);
        H.state.realUser=null; H.state.user={name:'QA',u:'qa',role:'msu',units:u,extras:[],active:true,title:''}; H.renderApp(); }""")
    for tab in ["pano","depo","yukler","arabalar","talepler","tanim","aletler","komuta"]:
        pg.evaluate("(t)=>{window.H.closeModal&&window.H.closeModal(); window.H.go('sterilizasyon',{tab:t});}", tab)
        pg.wait_for_timeout(350)
        pg.screenshot(path=OUT+"\\ster_"+tab+".png", full_page=False)
    # birkaç modal
    pg.evaluate("()=>window.H.go('sterilizasyon',{tab:'tanim'})"); pg.wait_for_timeout(250)
    pg.evaluate("()=>{const el=document.querySelector('.content [data-kart]'); if(el) el.click();}"); pg.wait_for_timeout(300)
    pg.screenshot(path=OUT+"\\modal_sablon.png", full_page=False)
    pg.evaluate("()=>window.H.closeModal&&window.H.closeModal()")
    pg.evaluate("()=>window.H.go('sterilizasyon',{tab:'pano'})"); pg.wait_for_timeout(250)
    pg.evaluate("()=>{const el=document.querySelector('.content [data-set]'); if(el) el.click();}"); pg.wait_for_timeout(300)
    pg.screenshot(path=OUT+"\\modal_setdetay.png", full_page=False)
    b.close()
print("OK", OUT)
