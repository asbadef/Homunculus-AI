# -*- coding: utf-8 -*-
import sys, io, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
from playwright.sync_api import sync_playwright

def login(pg, role): pg.evaluate("""(role)=>{const H=window.H;const u=H.units().map(x=>x.id);H.state.realUser=null;H.state.user={name:'QA',u:'qa',role,units:u,extras:[],active:true,title:''};H.renderApp();}""", role)
def go(pg, page, prm): pg.evaluate("(a)=>{window.H.closeModal&&window.H.closeModal();window.H.go(a[0],a[1]||{});}", [page, prm])

# UI chrome text topla; sözlükte (key veya herhangi dil value) olmayanları aday göster.
COLLECT = r"""
() => {
  const D = window.HMC_SOZLUK || {};
  const known = new Set();
  for (const k in D){ known.add(k.trim()); const v=D[k]; for(const L in v){ if(v[L]) known.add(String(v[L]).trim()); } }
  const out = {};
  const sels = 'button, label, th, h2, h3, h4, h5, h6, summary, option, .tag, .chip, .seg button, .adm-sub, .ist-hd h5, .kv>span:first-child, .fr>label';
  document.querySelectorAll('.content ' + sels).forEach(el => {
    // sadece doğrudan metin (çocuk elementlerin metnini sayma)
    let t = '';
    el.childNodes.forEach(n => { if(n.nodeType===3) t += n.textContent; });
    t = t.replace(/\s+/g,' ').trim();
    if(!t) t = (el.children.length===0 ? el.textContent.replace(/\s+/g,' ').trim() : '');
    if(!t || t.length<2 || t.length>90) return;
    if(/^[\d\s.,:;/₼%+\-–—()#*]+$/.test(t)) return;     // sayı/sembol
    if(/^[A-Z0-9][A-Z0-9.\-]{1,}$/.test(t)) return;       // kod (SET-1049, HN-...)
    if(known.has(t)) return;                              // zaten sözlükte
    out[t] = (out[t]||0)+1;
  });
  return Object.keys(out);
}
"""

PLAN = [
  ("kabul","vezne",[{"tab":t} for t in ["giris","fatura","fiyat","kurumsal","indirim","iade","gfk","evrak"]]),
  ("kabul","randevu",[{"view":"liste"},{"view":"takvim"},{"view":"hafta"}]),
  ("sistem","ik",[{}]),
  ("yonetici","medmuhasebe",[{}]),
  ("yonetici","raporlar",[{}]),
  ("hekim","gelisler",[{}]),
  ("laborant","labislem",[{"tur":"lab"}]),
  ("hekim","istakip",[{}]),
  ("hekim","pharmacy",[{}]),
  ("yonetici","summary",[{}]),
  ("kabul","occupancy",[{}]),
  ("hemsire","tasks",[{}]),
  ("hemsire","hand",[{}]),
  ("hekim","alarms",[{}]),
  ("sistem","admin",[{"tab":t} for t in ["users","roles","structure","fiyat","ptip","bolumliste","integrations","system"]]),
]

cand = {}
with sync_playwright() as p:
    b = p.chromium.launch(headless=True); pg = b.new_page(viewport={"width":1500,"height":950})
    pg.on("dialog", lambda d: d.dismiss())
    pg.goto("http://localhost:5180/app/?hizli=1", wait_until="networkidle"); pg.wait_for_timeout(600)
    pid = pg.evaluate("()=>(H.data.patients&&H.data.patients[0]&&H.data.patients[0].id)||null")
    for role, page, plist in PLAN:
        login(pg, role)
        for prm in plist:
            go(pg, page, prm); pg.wait_for_timeout(250)
            for t in pg.evaluate(COLLECT):
                cand.setdefault(t, set()).add(page)
    # hasta360 + patient
    login(pg,"hekim")
    for page in ["hasta360","patient"]:
        go(pg,page,{"pid":pid,"tab":"ozet"}); pg.wait_for_timeout(300)
        for t in pg.evaluate(COLLECT): cand.setdefault(t,set()).add(page)
    b.close()

items = sorted(cand.items(), key=lambda x:(-len(x[1]), x[0].lower()))
print("=== ÇEVRİLMEMİŞ UI METİN ADAYLARI (%d) ===" % len(items))
for t, pages in items:
    print("%-55s | %s" % (t[:55], ",".join(sorted(pages))))
