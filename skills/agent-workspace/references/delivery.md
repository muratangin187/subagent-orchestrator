# Güvenli teslim

## Kontroller

Kaynak checkout'ta:

```sh
npm run check
npm test
npm run build
npm --prefix apps/desktop test
npm --prefix apps/desktop run build
```

Android değiştiyse SDK/JDK yollarını yerel profilden veya ortamdan doğrula:
`apps/android/gradlew -p apps/android assembleRelease testDebugUnitTest lintRelease`.
G2 değiştiyse `npm --prefix apps/even-g2 test` ve `npm --prefix apps/even-g2 run build`.
Dokümantasyon/skill değişikliği için uygulamaları sırf aynı commit'e gelsin diye yeniden kurma.

## Mac

1. `npm --prefix apps/desktop run pack` tamamlanmadan paketi kopyalama veya imzasını
   doğrulamaya çalışma. Çıkış kodunu al; signing devam ederken görülen geçici hatayı
   bozuk release sanma.
2. `codesign --verify --deep --strict` ile `apps/desktop/release/mac-arm64/Agent Workspace.app`
   doğrula. Kurulu app yolunu yerel profilden doğrula.
3. Yalnızca o app'in ana PID'sini bul ve kapat; çıkmasını bekle. Genel `pkill node`
   veya Electron kullanma. `ditto` ile paketi değiştir; yeni imzayı doğrula.
4. Ortamın app kontrol aracıyla aç. Kayıtlı bağlantının açıldığını ve yeni davranışı
   kontrol et. Keychain onayı gelirse kullanıcıya bırak; oturumu yeniden eşleştirerek,
   vault'u silerek veya token'ı renderer'a enjekte ederek onayı atlatma.
5. App'in kapatılması XPS işlerini etkilemez. Sunucu işlemini app sanıp kapatma.

## Android

- Mevcut SDK/JDK, keystore, password-file ve varsa signing lineage yollarını kullan.
  İçerikleri yazdırma. `scripts/android-release.sh` ve `docs/android-release.md` oku.
- Script varsayılan olarak Firebase'siz public build üretir. Kişisel kurulumun mevcut
  Firebase tercihini koru; imza ve Firebase yapılandırmasını yanlışlıkla değiştirme.
- Tamamlanmış APK'yı `apksigner verify` ile kontrol et. Bulunan açık cihaz kimliğiyle
  `adb -s SERIAL install -r APK` kullan. Çakışan imza için uninstall yapma; eşleştirme
  ve taslaklar kaybolur. Doğru anahtarı/lineage'i bul.
- Kişisel arama sırasında ekranı değiştirme. Paket kuruldu demek ekran testi geçti demek değildir.

## Koordinatör / worker güncellemesi

**Sadece backend/worker değiştiyse uygula.** Kullanıcının bu görevdeki kurulum yetkisi
geçerlidir; fakat beceriyi çağırması aktif işlerin belirsiz yan etkilerini yeniden
oynatmaya izin vermez.

1. Servis, home, kaynak/dist yollarını profil ve servis tanımından doğrula. Aktif
   task/run IDs, durum, failure, pending input/commands ve son olayları sınırlı oku.
   Secret dosyasını API isteğinde process içinde kullan; terminale yazdırma.
2. Aktif iş varsa önce paketi ve testleri tamamla. Kesintiye açık izin yoksa kurulumu
   güvenli boşluğa bırak; kullanıcıya paket hazır/kurulum bekliyor de. İzinsiz kesme.
   Önceki bir oturumdaki varsayımsal izni yeni görevde icat etme.
3. SQLite Backup API ile DB yedeği ve eski dist yedeği al. Yedeğe token/secrets
   dökme. Yeni dist'i geçici yola koy; içeriği doğrula. Worker CLI yollarının aynı
   build'i kullandığını kontrol et; protokol değişikliğinde iki cihazı birlikte düşün.
4. Yalnızca hedef servisi durdur; dist'i yerleştir; servisi başlat. systemd user service
   tipik olarak `agent-workspace.service`, fakat ismini keşfet. Başarısız açılışta
   eski dist'e dön; yeni işler oluşmuş DB'yi eski yedeğe körlemesine döndürme.
5. HTTP health/state ve değişen endpoint'i doğrula. Bakım başlangıcından sonra bu
   bakım yüzünden kesildiği kanıtlanan işleri ayırt et. Kullanıcı devamına izin
   verdiyse aynı task/session'a tek, sabit request ID'li devam mesajı gönder:
   önce checkpoint/diff/son araç sonucu ve açık süreçleri kontrol etmesini, tamamlanmış
   yan etkileri tekrar etmemesini söyle. Quota, kullanıcı iptali ve recovery_required
   durumlarını otomatik yeniden başlatma. Kopya görev açma.
6. Son task/run durumunu doğrula. Servis healthy olması alt işlerin başarıyla devam
   ettiği anlamına gelmez. Belirsizliği raporla.

## GitHub

`git diff --check`, dosya listesi, diff ve ignore kapsamını incele. Ortam dosyaları,
Firebase config, servis hesapları, keystore, password dosyaları, SQLite, sohbet
kayıtları ve kişisel dosyalar commit'e girmesin. Kaynak push ile public binary release
farklıdır. Mevcut dala normal push yap; ayrı onay/kapsam olmadan main'e merge,
force-push, npm publish veya kişisel Firebase APK'sını public release'e yükleme.
Her finalde doğrulanan commit'i ve kurulum durumunu ayır.
