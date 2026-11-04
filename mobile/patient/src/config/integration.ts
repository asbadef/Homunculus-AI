// M1 = HBYS paneli ile ortak backend. Sahip kararı: M1 şimdilik ERTELENDİ, bu yüzden
// bayrak kapalı ve app offline/demo çalışır. M1 açıldığında tek yer burada açılır
// (M1_ENABLED=true + API_BASE), gerisi src/api/client.ts içindeki uçlardan akar.
//
// Panel (dijitalfabrikaaa-maker/fabrika-ofis) tarafındaki hazır veri uçları
// (Homunculus Genel Süreçler oturumundan):
//   - Sıra/çağrı:   H.data.sira[pid]  (hastanın no'su),  H.data.siraSon (çağrılan)
//   - Bildirim:     H.pushNotif({ to: [...], pid })  — pid taşır, hastaya yansıtılabilir
//   - Branş→birim:  hasta app'inde branch.unitId (pol/dax/cer/usq/kem/gun/ivf)
export const M1_ENABLED = false;

// M1'de HBYS köprüsünün adresi buraya yazılacak.
export const API_BASE = "";

// Demo modda kullanıcıya gösterilecek standart "henüz bağlı değil" mesajı.
export const M1_OFFLINE_MSG = "demo";
