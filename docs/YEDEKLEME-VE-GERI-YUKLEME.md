# Yedekleme ve Geri Yükleme Prosedürü (O4)

**Durum:** Taslak — Başkan onayı ve doğrulamalar bekliyor. Bu belge bir **plandır**; aşağıdaki "Doğrulanacaklar" tamamlanmadan yedekleme güvence altında sayılmaz.
**Kapsam:** Homunculus motorunun PostgreSQL veritabanı (Supabase). Denetim kayıtları (`security_audit_events`) da aynı veritabanındadır, bu yüzden aynı yedeğe girer.
**Kural:** Gerçek hasta verisiyle deneme yapılmaz. Geri yükleme provası yalnızca sentetik veriyle ya da şifreli yedek yalnızca yetkili kişilerce açılarak yapılır.

## 1. Doğrulanacaklar (Başkan / yetkili hesap sahibi)

Supabase paneli gerektirdiği için kod tarafında yapılamaz.

- [ ] Projenin Supabase planı nedir? Otomatik günlük yedek bu planda var mı, kaç gün saklanıyor? (Ücretsiz planda otomatik yedek yoktur ya da kısıtlıdır — doğrulanmalı.)
- [ ] Point-in-time recovery (PITR) açık mı? Gerekiyorsa plan yükseltmesi Başkan kararıdır.
- [ ] Veritabanı bölgesi ve yedeklerin saklandığı yer (hasta verisinin ülke dışına çıkıp çıkmadığı hukuki açıdan kontrol edilmeli).

## 2. Yedek katmanları

| Katman | Sıklık | Saklama | Nerede |
|---|---|---|---|
| Supabase otomatik yedek | Günlük (plana bağlı) | Plana bağlı | Supabase |
| Şifreli dış yedek (`pg_dump`) | Haftada bir | 12 hafta | Supabase dışında, ayrı bir hesapta/diskte |

Dış yedek, Supabase hesabının ele geçirilmesi ya da kapanması durumuna karşıdır.

## 3. Haftalık şifreli dış yedek

Yedek alan makinede `DATABASE_URL_BACKUP` (salt-okunur bir veritabanı rolü) ve `BACKUP_PASSPHRASE` ortam değişkenleri tanımlı olmalıdır. Değerleri belgeye, koda ya da komut geçmişine **yazmayın**.

```sh
set -euo pipefail
STAMP=$(date +%Y%m%d)
pg_dump --format=custom --no-owner "$DATABASE_URL_BACKUP" \
  | gpg --batch --symmetric --cipher-algo AES256 \
        --passphrase-fd 3 3<<<"$BACKUP_PASSPHRASE" \
  > "homunculus-$STAMP.dump.gpg"
sha256sum "homunculus-$STAMP.dump.gpg" > "homunculus-$STAMP.dump.gpg.sha256"
```

Notlar:
- Alanlar zaten uygulama katmanında Fernet ile şifrelidir (hasta alanları, `totp_secret`). Yedekte bu şifreli değerler durur; **`PHI_ENCRYPTION_KEY` yedekle birlikte saklanmaz.** Anahtar kaybolursa şifreli alanlar yedekten de açılamaz — anahtarın kendi güvenli yedeği ayrıca tutulmalıdır (yedekten ayrı yerde).
- Yedek dosyaları 12 haftadan eskiyse silinir.
- Her yedekten sonra `sha256sum -c` ile bütünlük kontrol edilir.

## 4. Üç ayda bir geri yükleme provası

Amaç: yedeğin gerçekten açılabildiğini ve uygulamanın onunla çalıştığını kanıtlamak.

1. En son şifreli yedeği al, `gpg --decrypt` ile çöz.
2. **Üretimden ayrı**, boş bir PostgreSQL 16 örneğine yükle: `pg_restore --no-owner --dbname <deneme-veritabanı> homunculus.dump`.
3. `alembic current` çıktısı yedeğin sürümüyle (`alembic heads`) eşleşmeli.
4. `PHI_ENCRYPTION_KEY` ile motoru bu veritabanına bağlayıp bir hasta kaydını ve bir kullanıcıyı okuyarak şifre çözmenin çalıştığını doğrula.
5. `security_audit_events` satır sayısı ve en yeni kayıt tarihi, yedek zamanıyla tutarlı olmalı.
6. Geri yükleme süresini (RTO) ve yedek yaşını (RPO) not al.
7. Deneme veritabanını ve çözülmüş dosyaları sil.

Prova sonucu `docs/` altında tarihli kısa bir kayıtla (tarih, süre, sonuç, sorunlar) saklanır. **İlk prova tarihi:** henüz yapılmadı.

## 5. Gerçek geri yükleme (olay anı)

Üretimde geri yükleme **Başkan onayıyla** yapılır. Önce uygulama bakım moduna alınır, sonra Supabase yedeğinden veya dış yedekten geri dönülür, son olarak 4. bölümün 3–5. adımları üretimde kontrol edilir.
