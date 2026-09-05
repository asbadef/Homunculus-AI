// Every user-visible string in the app. A second locale is a sibling file, not a refactor.
// These strings are also scanned by the no-orders charter test — see src/domain/noOrders.ts.
export const tr = {
  "identity.missing": "Kimlik kaydı yok",
  "identity.manual": "Elle giriş",
  "identity.discharged": "Taburcu",
  "app.name": "Homunculus",
  "app.demoBanner": "GÖSTERİM VERİSİ — kayıtlı sentetik senaryo",

  "tabs.patients": "Hastalar",
  "tabs.alerts": "Uyarılar",
  "tabs.settings": "Ayarlar",

  "ward.empty": "Koğuşta gösterilecek yatak yok.",
  "ward.loading": "Koğuş yükleniyor…",

  "bed.label": "YB Yatak {bed}",
  // M5: MonitorTile's row-1 identity chip — shorter than `bed.label`, which the detail screen
  // still uses ("YB Yatak {bed}"). A monitor tile has no room for the "YB" prefix and the mockup
  // renders just the bed number.
  "bed.tileLabel": "YATAK {bed}",

  "risk.none": "Sakin",
  "risk.info": "Bilgi",
  "risk.low": "Düşük",
  "risk.moderate": "Orta",
  "risk.high": "Yüksek",
  "risk.critical": "Kritik",

  "alert.unacknowledged": "Onaylanmadı",
  "alert.acknowledged": "Onaylandı",
  "alert.escalated": "ESKALE EDİLDİ",
  "alert.acknowledge": "Onayla",
  "alert.reasoning": "Klinik gerekçe",
  "alert.actions": "Önerilen adımlar",
  "alert.confidence": "Kanıt gücü",
  "alert.sources": "Kaynaklar",
  "alert.chronicContext": "Kronik bağlam",
  "alert.downgraded": "Hastanın kendi bazaline göre indirgendi",
  // M6: the detail screen's alert card ghost pill — opens the existing guideline drawer for one
  // of the alert's supporting_evidence entries (see AlertCard.tsx; there is one pill per citation
  // so a two-source alert keeps both sources reachable).
  "alert.guideline": "Kılavuz",

  "stale.badge": "Bayat veri: {inputs}",

  "vital.heartRate": "Kalp hızı",
  "vital.map": "OAB",
  "vital.lactate": "Laktat",
  "vital.sofa": "SOFA",
  "vital.noData": "veri yok",
  "vital.trend": "Senaryo zamanı eğilimi",

  // Cockpit vitals-row cell labels (M4) — short forms for a narrow grid cell, distinct from the
  // full names above used on the detail screen's trend tiles.
  "vital.hr": "NB",
  "vital.spo2": "SpO2",
  "vital.tempShort": "Ateş",
  "vital.rr": "SS",

  "ward.title": "Koğuş",
  "ward.sourceReplay": "KAYIT",
  "ward.sourceLive": "CANLI",
  // M6: the kit's chip row (restored/added — M5's cockpit header dropped these; the bedside-
  // monitor look is gone, the ward reads as the kit's ward screen now).
  "ward.allUnits": "Tümü",
  "ward.occupancy": "{occupied}/{total} dolu",
  "ward.criticalCount": "Kritik {n}",
  "ward.warningCount": "Uyarı {n}",
  "flag.stable": "STABİL",
  "tile.escalatedPill": "ESKALE",
  "kind.septic_shock": "SEPTİK ŞOK",
  "kind.under_resuscitated_sepsis": "SIVI YETERSİZ",
  "kind.sepsis": "SEPSİS",
  "kind.antibiotic_due": "ANTİBİYOTİK PENCERESİ",
  "kind.antibiotic_overdue": "ANTİBİYOTİK GECİKTİ",
  "kind.news2": "NEWS2",
  "kind.acute_change": "AKUT DEĞİŞİM",
  "kind.sepsis_watch": "SEPSİS İZLEM",
  "channel.hr": "NABIZ",
  "channel.map": "OAB",
  "channel.lactate": "LAKTAT",
  // M6: BedCard's stat pill labels — shorter than the full names above (`vital.lactate`) to fit a
  // pill, distinct from the cockpit's row-cell abbreviations (`vital.hr` etc.) that Task 3/4's
  // detail screen still uses.
  "vital.lactateShort": "LAK",

  "detail.vitals": "Vital bulgular",
  "detail.alerts": "Aktif uyarılar",
  "detail.noAlerts": "Aktif uyarı yok.",
  "detail.back": "Geri",
  "detail.missing": "Bu yatak koğuşta bulunamadı.",

  "drawer.title": "Kılavuz kaynağı",
  "drawer.authority": "Otorite",
  "drawer.authority.high": "yüksek",
  "drawer.authority.moderate": "orta",
  "drawer.authority.low": "düşük",
  "drawer.superseded": "Bu kaynak daha yeni bir baskıyla değiştirildi.",
  "drawer.unknown": "Kaynak notu bulunamadı: {id}",
  "drawer.note": "Kaynak başlığı Homunculus kasasından alınmıştır; kanıt gücü ifadesi uyarının kendi alanından gelir.",
  "drawer.close": "Kapat",

  "alerts.title": "Uyarı akışı",
  "alerts.escalatedSection": "Eskale edilenler",
  "alerts.newSection": "Yeni uyarılar",
  "alerts.empty": "Henüz uyarı yok.",

  "theme.title": "Tema",
  "theme.icu": "Gece / Nöbet",
  "theme.light": "Gündüz Klinik",

  "settings.title": "Ayarlar",
  "settings.playback": "Oynatma",
  "settings.play": "Oynat",
  "settings.pause": "Duraklat",
  "settings.restart": "Başa sar",
  "settings.speed": "Hız",
  "settings.role": "Rol",
  "settings.role.nurse": "Hemşire",
  "settings.role.doctor": "Hekim",
  "settings.haptics": "Titreşimli geri bildirim",
  "settings.threshold": "Eskalasyon eşiği",
  "settings.thresholdNote": "Sunucudaki gerçek eşik 5 dakikadır. Buradaki kısa süre yalnızca gösterim hızlandırmasıdır.",
  "settings.dataSource": "Veri kaynağı",
  "settings.dataSourceValue": "Kayıtlı senaryo — icu-ward.json",
  "settings.version": "Sürüm",

  "server.title": "Sunucu",
  "server.address": "Sunucu adresi",
  "server.addressPlaceholder": "http://10.0.0.5",
  "server.save": "Kaydet",
  "server.login.email": "E-posta",
  "server.login.password": "Parola",
  "server.login.submit": "Giriş yap",
  "server.logout": "Oturumu kapat",
  "server.goLive": "Canlı moda geç",
  "server.goReplay": "Gösterime dön",
  "server.status.demo": "Gösterim modu — kayıtlı senaryo",
  "server.status.connecting": "Bağlanıyor…",
  "server.status.open": "Canlı — sunucuya bağlı",
  "server.status.reconnecting": "Bağlantı koptu — yeniden bağlanıyor…",
  "server.sessionNotice": "Oturum sona erdi; gösterime dönüldü.",

  "login.mfaUnsupported": "Bu hesap doğrulama kodu istiyor; şimdilik panodan giriş yapın.",
  "login.failed": "Giriş başarısız: {detail}",
} as const;
