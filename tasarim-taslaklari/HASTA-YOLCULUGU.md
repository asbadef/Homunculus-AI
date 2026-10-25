# Hasta Yolculuğu — Uçtan Uca Denetim · 25.10.2026

"Bir hasta gibi düşün: hastaneye geldin, kim sana ne yapar?" — her adımın **rolü · ekranı · yetkisi · durumu** ve bulunan kopukluk/yanlışlar. Zincir testle (qa) doğrulandı.

## Zincir (geliş → taburcu)
| # | Adım | Rol | Ekran | Yetki | Durum |
|---|------|-----|-------|-------|-------|
| 1 | **Hasta kabul** (kimlik, protokol) | hasta kabul / vezne | `admission` + ortak `H.kabulForm` | admission | ✅ protokol otomatik açılır |
| 2 | **Randevu → kabul** | hasta kabul (doktor görüntüler) | `randevu` → `drislem` | admission / admission_view | ✅ (yetki sızıntısı kapatıldı) |
| 3 | **Muayene** (anamnez/fizik/tanı/plan) | hekim | hasta360 → Tedavi → Muayene (`docs.js`) | results | ✅ zengin editör; imzada Dokümanlar'a düşer |
| 4 | **İstem** (lab/rad/ilaç/kan/konsültasyon) | hekim | Muayene → İstem (`H.orders`) | orders | ✅ ilaç artık katalogdan (H.ILAC) |
| 5 | **Numune** (örnek al) | hemşire al · laborant kabul | `numune` | tasks / lab_islem | ✅ no+tüp+lab; Bekliyor→Alındı→Kabul/Red |
| 6 | **Lab/Rad sonuç** | laborant | `labislem` | lab_islem | ✅ sonuç girer (o.sonuc) · *trend/anormal vurgu eksik* |
| 7 | **Sonuç hekime** | hekim | hasta360 → Tedavi → Laboratuvar | results | ✅ sonuç görünür |
| 8 | **İlaç uygulama** | hemşire | görev çizelgesi (`H.medAct`) | tasks | ✅ var |
| 9 | **Eczane karşılama** | eczacı | `pharmacy` | pharmacy | ✅ **yeni bağlandı** (ilaç istemi→Karşıla) · *muadil/DDI eksik* |
| 10 | **Fatura / tahsilat** | vezne | `vezne` | vezne | ✅ · *ilaç/hizmet fiyatının faturaya otomatik akışı eksik* |
| 11 | **Taburcu / epikriz** | hekim | hasta360 → Dokümanlar → Epikriz | results | ✅ epikriz editörü var |

## Bu denetimde bulunan ve DÜZELTİLEN
- **Rol sızıntısı:** hemşire Randevu+Lab tekniker ekranını, Mali İşler Lab tekniker ekranını görüyordu → dar yetkiye bağlandı. (v0216–0217)
- **Eczane kopukluğu:** doktorun ilaç istemi eczaneye düşmüyordu → `pharmacy`'ye "karşılanacak ilaç istemleri + Karşıla" eklendi. (v0218)
- **Admin yetki canlılığı:** admin yetki verince/silince kullanıcı sidebar'ı anında güncelleniyor (test geçti).

## Rol başına "olmaması gereken" (tarandı)
Her rol sol menüde yalnız kendi işini görüyor (NAV taraması tüm roller için yapıldı, 2 leak kapatıldı). Kalan denetim: **ekran-içi buton/aksiyon yetkisi** (bir ekranı görüp bazı butonları görmemesi gereken rol) — numune/ilaç/eczanede test edildi; tam tarama "kapsama turunda".

## Eksik / kopuk — SIRADA (kaybolmasın)
1. [x] **İlaç/hizmet → fatura fiyat zinciri (1. halka)** (v0219): İstem order'ı `kod` taşır → `fiyatOf` fiyatlar → İş Havuzu'nda tutar/toplam. *Kalan: faturaya otomatik satır postalama.*
2. [x] **Eczane derinliği** (v0220): Bekliyor/Karşılandı/Reddedildi/Transfer + Onayla/Reddet/Transfer/Muadil/Etkileşim. *Kalan: stok/miadı/iade/ITS + tam DDI motoru.*
3. [x] **Lab/Rad anormal vurgu** (v0221): H.LABREF referans aralıkları + yapısal sonuç + ↑/↓ renkli işaret. *Kalan: zaman-içi trend + admin referans düzenleme + rad PACS.*
4. [x] **Yatan/servis** (v0222): `yatanlar` ekranı (yatan/yoğun liste) + Transfer/Taburcu mevcut admission akışına hasta ön-seçimli bağlandı; yetki gated. *Kalan: yatan gözlem/flowsheet derinliği.*
5. [~] **Buton-seviyesi yetki kapsama turu**: yeni ekranların (numune/eczane/yatanlar/ilaç admin/drislem) aksiyon yetkileri test edildi; ana hassas vezne aksiyonları (indirim/fatura iptal/toplu fatura/dönem onay) `canAct` ile gated. *Kalan: tüm 40 ekranın buton-buton tam taraması (sahibin testiyle birlikte).*
6. **Lab/Radyoloji tekniker süreci** (sahip anlatacak): numune Kabul→çalışma→sonuç onay→rapor zinciri derinliği.
7. Cila: "Yönetim" sidebar etiketi audit-only rollerde "Denetim kaydı" görünsün; İş Listesi sayaç tıklanır filtre; üst bar sadeleştirme.
8. Diğer içe aktarma: hizmet/tanı/form/yetki .xls.

Sıra önerisi: (1) ilaç→fatura zinciri → (2) eczane derinliği → sahip lab tekniker anlatınca (6). Her adımda smoke 0 + commit + sahip testi.
