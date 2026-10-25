# -*- coding: utf-8 -*-
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(headless=True); pg = b.new_page()
    pg.goto("http://localhost:5180/app/?hizli=1", wait_until="networkidle"); pg.wait_for_timeout(600)
    pg.evaluate("""() => { const H=window.H; H.state.realUser=null; const u=H.units().map(x=>x.id);
        H.state.user={name:'QA',u:'qa',role:'sistem',units:u,extras:[],active:true,title:''}; H.renderApp(); }""")
    for role in ["msu","laborant"]:
        nav = pg.evaluate("""(role)=>{ const H=window.H; const u=H.units().map(x=>x.id);
            H.state.realUser=null; H.state.user={name:'QA',u:'qa',role,units:u,extras:[],active:true,title:''}; H.renderApp();
            return [...document.querySelectorAll('.rail .ri')].map(x=>x.textContent.trim()).filter(Boolean);
        }""", role)
        home = pg.evaluate("(role)=>window.H.data.roles[role].home", role)
        print(role, "· home:", home, "· menü:", nav)
    # quick-login listesinde görünüyor mu
    q = pg.evaluate("""()=> (window.H.data.users||[]).filter(u=>u.active!==false).map(u=>u.u)""")
    print("hızlı giriş kullanıcıları:", [x for x in q if x.startswith('msu') or x.startswith('lab')])
    b.close()
