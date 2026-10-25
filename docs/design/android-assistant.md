# Android asistan ve oturum çalışma alanı

Durum: tasarım ve uygulama planı; çalışan Android uygulaması değildir.
Tarih: 2026-10-25. Kullanıcı kararı: Android APK; mevcut ve yeni Codex/Claude oturumları.

## Ürün sözleşmesi

Uygulama Asistan ekranında açılır. Tek bir kalıcı Codex konuşması kullanıcının
isteklerini alır, uzun işleri bağımsız alt ajanlara dağıtır ve kısa sonuç verir.
Kullanıcı bir iş sürerken başka bir konuya geçebilir. İşler drawer'da görünür;
her işin alt ajan konuşmasına doğrudan gidilebilir. Oturumlar ekranı ayrı bir
çalışma alanıdır: geçmişi keşfetme, yeni konuşma, mevcut konuşmaya devam ve dosya.

Asistanın “başlattım” demesi görev kaydı gerçekten kabul edildikten sonra olur.
“Tamamlandı” mesajı doğrulanmış terminal sonuçtan türetilir. Başarısızlık, kota,
izin ve kullanıcıdan bilgi bekleme ayrı durumlardır. Zaman aşımı başarı değildir.
Asistan kendi çocuklarını senkron beklemez; sonuç ayrı bir olayla yeni tur açar.

## Bugün doğrulananlar ve eksikler

- Codex 0.164.0 `thread/list` salt okunur çağrısı gerçek yerel oturumları döndürdü.
- Kurulu Claude Agent SDK 0.3.310 `listSessions` çağrısı gerçek oturumları döndürdü.
  SDK `getSessionMessages`, `getSessionInfo` ve `resume` yüzeyleri mevcut.
- Orkestratörde kalıcı görev/tur/olay/bildirim ve kota sınıflandırması var.
- `src/transport.ts` yalnızca yerel Unix soket RPC sunuyor. Telefon API'si yok.
- `src/engine.ts` alt görev odaklı. Genel oturum yöneticisi ve asistan inbox'ı yok.
- Mevcut çocuk adaptörleri diğer MCP sunucularını kapatıyor. Slack/email araçları
  otomatik olarak çocuklara geçmez. Asistan profili ve iş bazlı araç profilleri şart.
- Harici süreçte aktif konuşmayı güvenle devralma henüz doğrulanmadı.
- Native dosya/görsel girişleri, geçmiş sayfalama uyumluluğu ve Android arka plan
  bildirimleri ayrı protokol/cihaz testleri gerektiriyor.

Bu incelemede özel konuşma metinleri çıktıya, dokümana veya repoya alınmadı.

## Önerilen yapı

Android Kotlin + Jetpack Compose + Material 3; Room yerel önbellek, ViewModel ve
StateFlow, OkHttp akış bağlantısı, Android Keystore cihaz anahtarı. WebView veya
PWA kabuğu değil. SDK sürümleri uygulama başlangıcında resmi kaynaklarla sabitlenir.
Android dışı istemci gelecekte aynı API'yi kullanabilir.

Mevcut TypeScript servisi korunur. HTTP gateway yalnızca loopback üzerinde açılır;
Tailscale Serve HTTPS ile tailnet içine sunar. Telefon doğrudan CLI veya SQLite'a
bağlanmaz. Gateway, daemon'un yetkilendirilmiş komut/olay API'sini kullanır.
Ham mevcut RPC'yi dışarı açmayız: istemcinin scope/ceiling/cwd seçmesine izin verilmez.
SQLite mutasyonlarını tek servis sahiplenir; gateway ikinci görev yazarı olmaz.

Katmanlar:

1. Android: Asistan / Oturumlar / görev drawer / dosya seçici / soru kartları.
2. Gateway: cihaz eşleme, yetkilendirme, idempotent HTTP komutları, olay akışı.
3. SessionService: yerel oturum keşfi, normalize geçmiş, tek yazıcı, adaptörler.
4. AssistantController: inbox, turn arbiter, outbox ve görev-sonuç eşlemesi.
5. Mevcut Engine: alt ajan ağacı, worktree, izin tavanı, kuyruk, iptal ve kurtarma.
6. Sağlayıcılar: Codex app-server; Claude Agent SDK + yerel CLI.

Önerilen repo dizinleri: `apps/android`, `src/gateway`, `src/sessions`,
`src/assistant`, `src/attachments`, `test/assistant`, `test/gateway`.
Çalışan MCP CLI ve mevcut 34 regresyon korunur. İlk dikey dilimde monorepo araç
zincirini baştan değiştirmeyiz; Android Gradle ve TypeScript kendi build'ini tutar.

## Kalıcı asistan: konuşma kimliği kalır, işlem sürekli açık olmak zorunda değil

`assistant_profile` içinde `nativeSessionId`, provider/model, proje kökü,
instruction sürümü, araç profili ve izin politikası saklanır. Kullanıcı mesajı
veya tamamlanmış iş olayı geldiğinde aynı oturum resume edilir. Profil ilk defa
oluşturulurken başlangıç brief'i bir kez, `bootstrap:<profileId>:<version>`
anahtarıyla gönderilir. Her açılışta dev ilk mesaj tekrar gönderilmez.

Uzun konuşma sonsuz bağlam değildir. Sağlayıcı compaction'ı desteklenir; ayrıca
kararlar, kullanıcı tercihleri ve aktif iş indeksleri ayrı kalıcı bellek olarak
saklanır. Resume başarısızlığında sessiz yeni konuşma açılmaz. “Oturum onarımı
gerekiyor” gösterilir; kullanıcı kontrollü taşıma, eski/yeni kimlik ve özet kaydıyla yapılır.

Instruction yalnız başına garanti vermez. Asistan araç profili async delegasyonu
zorlar; onun için bloklayan `wait_for_task` verilmez. Genel oturumlar ve çocukların
bekleme araçları çalışmaya devam eder. “İşi kısa biçimde kabul et ve turu bitir”
davranışı prompt ve araç sözleşmesiyle desteklenir; süre bütçesi aşımı UI'da görünür.

## Olaydan tekrar asistan turuna

Kullanıcı mesajı → kalıcı inbox → tek aktif asistan turu → async görev kabulü →
kısa yanıt → tur biter. Çocuklar bağımsız devam eder. Çocuk terminal/soru/kota
olayı → aynı transaction'da outbox → inbox'a idempotent teslim → asistan resume
→ kanıtı incele → kullanıcıya kısa sonuç veya soru kartı.

- Her olay `(source, sourceEventId)` ile tekilleşir. Her komut `clientRequestId`
  taşır. Bir notification için iki kullanıcı özeti üretmemek üzere delivery kaydı tutulur.
- Bir asistan konuşmasında bir aktif tur. Gelen kullanıcı mesajı görünür biçimde
  sırada; kısayol olarak aktif turu kesme kullanılabilir. Sağlayıcıya iki paralel
  `turn/start` gönderilmez. UI'nin cevap verme vaadi değil, anında yerel kayıt vaadi vardır.
- Kullanıcı girdisine öncelik; ardışık kullanıcı girdilerinde sonuçlar sonsuza
  ertelenmez. Sonuçlar kısa pencere içinde paketlenir; soru/izin olayları bekletilmez.
- Token delta'ları asistanı uyandırmaz. Terminal sonuç ve action-required olayları uyandırır.
- Asistanın kendi çıktısı kendisine tekrar olay olmaz. Kaynak tipleri ve dedupe
  anahtarları döngüyü engeller. Model/provider dış çağrılarında exactly-once garantisi verilmez.
- Süreç, provider isteği gönderildiği sırada çökerse delivery `uncertain` olur.
  Yeni turu körlemesine tekrarlamak yerine native geçmiş ve tool receipt'leri uzlaştırılır.
- Telefon çevrimdışı olsa da asistan controller ve alt işler bilgisayarda yürür.
  Bilgisayar kapalı/uykudaysa ilerleme yok; uyandıktan sonra kuyruk uzlaştırılır.
- Ana Codex kotası dolarsa controller kullanıcıya modelsiz “Asistan kota nedeniyle
  bekliyor” durum kartı üretir. Çocuk sonuçlarını kaybetmez. Modeli otomatik değiştirmez.

## Oturumlar: mevcut konuşma ile aktif süreci ayır

Yeni oturumda provider, canlı katalogdan model, izin profili ve kayıtlı proje seçilir.
Oturum listesi kaynağı gösterir: uygulama / terminal / IDE / alt ajan. Asistan
sabitlenir; mevcut oturumlar sağlayıcının desteklediği yerel depolardan keşfedilir.
Başka makine veya başka CODEX_HOME altındaki konuşmalar varsayılan olarak görünmez.

Codex: initialize → thread/list/read → desteklenen tarihçe sayfalama → resume/start.
Claude: listSessions/getSessionMessages → query resume. Kurulu sürümle capability
probe yapılır; internetteki yeni dokümanın bütün alanları var sayılmaz.
Bozuk geçmiş, silinmiş cwd, desteklenmeyen kayıt ve erişim hatası ayrı raporlanır.

Yalnızca geçmişi okumak aktif native oturuma bağlanmak değildir. Uygulama içi
tek yazıcı lease'i harici terminali kilitlemez. Harici aktiflik bilinmiyorsa
“Harici oturum / denetim belirsiz” gösterilir; yazma için terminal turunun durduğu
teyidi ve devam hakkı alma akışı gerekir. Zorla süreç öldürülmez. Fork alternatif
olarak açıkça sunulur; orijinal konuşmaya yazılmış gibi gösterilmez.
Dış istemcide sürdürülen canlı token akışı her iki sağlayıcı için garanti edilmez.

Mesaj listesi sayfalı ve sanallaştırılmıştır. Normalize bloklar: text, image,
attachment, tool_call, tool_result, approval, question, status, error; bilinmeyen
blok için güvenli ham JSON detayı. Tool çıktıları varsayılan kapalı; terminal
kaçış dizileri ve HTML çalıştırılmaz. Asistan sohbetinde yalnızca kısa özetler;
alt ajan ekranında gerçek araç olayları ve kaynak bağlantıları.

## MCP ve kişisel araçlar

Mevcut bağımsız çocukların bütün MCP'lere erişimi yok. `assistant`, `research`,
`implementation`, `communications` gibi açık araç profilleri eklenir. Kullanıcının
kurulu entegrasyonları listelenir; gerekli bağlantılar seçilerek bağlanır. Eksik
Slack/email girişi “bağlantı gerekiyor” olur; ana sohbetin bağlantısı varsayılmaz.
Sırlar telefon veya görev brief'ine kopyalanmaz; sağlayıcı/gateway bilgisayarda tutar.

Mesaj okuma ile gönderme ayrı işlem yetkileri. “Özetle” gönderim yetkisi değildir.
Kullanıcının açık göreve özel veya kalıcı izinleri uygulanır; izin zaten varsa
tekrar soru üretilmez. Yeni onay gerekirse taslak, alıcı, kanal ve eylem gösterilir.
Okunan email, Slack, dosya ve alt ajan sonuçları güvenilmeyen içeriktir;
bunların içindeki talimatlar yeni kullanıcı yetkisi sayılmaz.

## İnsan girdisi ve çocuğa doğrudan müdahale

Soru `requestId + taskId + runId + questionId` ile bağlanır. Kullanıcı karttan
cevap verir; controller doğru çocuğa `answer_subagent` gönderir. Eski kart,
iptal edilmiş iş ve aynı soruya ikinci yanıt açık sonuç verir. Normal metin
cevabının hangi işe ait olduğu belirsizse kısa netleştirme gerekir; tahminle yanlış
çocuğa gönderilmez. Serbest metin soruları için çocuklara yapılandırılmış soru
aracı kullanma talimatı verilir; yalnızca soru işareti arayarak routing yapılmaz.

Kullanıcı alt ajan sohbetine girip doğrudan mesaj gönderebilir. Bu müdahale ana
asistanın inbox'ına özet olay olarak gider. Ana asistan eski talimatı yeniden
uygulamaz; yeni revision'a göre ilerler. Asistanın özet mesajı doğrulanmış iş
sonucuna bağlantı içerir. “Bitti” ile “test edildi” ayrı kanıtlar gerektirir.

## Dosyalar

Android Storage Access Framework / Photo Picker ile seçilir; sunucunun rastgele
mutlak yolu telefon girdisi olarak kabul edilmez. Upload önce ayrı kimlikle
başlar; boyut, MIME, hash ve tamamlanma durumu saklanır. İlk ürün sınırı önerisi
25 MiB/dosya ve mesaj başına 5 ek; capability/config çıktısında görünür olmalı.
Yarım upload mesaj ekine dönüşmez. Retry aynı upload kimliğiyle yinelenmez.

Görsel destekleyen provider/model için native image blokları; metin/kod dosyaları
kapsamlı workspace attachment alanına alınır. PDF gibi türler destek durumuna
bağlı dönüştürülür; desteklenmiyorsa açık hata veya dosya olarak okuma seçeneği.
Dosya “gönderildi” demek modelin görseli yorumlayabildiği anlamına gelmez.
Özel izinli dizin, path traversal/symlink denetimi, disk kotası ve açık temizleme.

## Tailscale ve cihaz erişimi

`127.0.0.1` gateway → Tailscale Serve HTTPS → Android Tailscale ağı.
Funnel/public exposure yok. OS daemon yönetimi mevcut Serve rotalarını ezmez.
Ağ üyeliği uygulama yetkilendirmesi yerine geçmez. Bilgisayarda tek kullanımlık,
kısa ömürlü eşleme kodu; cihaz başına iptal edilebilir token; Android Keystore;
HTTPS sertifika doğrulaması. Tokenlar URL/log içine konmaz. Cihazın scope ve izinleri
sunucuda kayıtlıdır. Web origin kontrolleri, yetkisiz SSE ve upload denemeleri reddedilir.
Her takım arkadaşı kendi bilgisayar servisinde kendi sağlayıcı girişlerini kullanır;
bu ilk sürüm ortak çok kullanıcılı SaaS veya merkezi hesap paylaşımı değildir.

## Android bildirimleri ve çevrimdışı davranış

Ön planda HTTPS SSE; komutlar idempotent HTTP POST. Her olay sıra numarası taşır.
Last-Event-ID ile yeniden bağlanılır; retention dışı cursor snapshot+watermark ile
uzlaştırılır. Room UI'nin veri kaynağı; teslim state'i local_pending → accepted →
processing → completed/failed. Gönderildi işareti sunucu kabulünden önce çıkmaz.
Çevrimdışı mesaj kalıcı outbox'ta bekler ve iptal edilebilir; tekrar ağa bağlanınca
aynı kimlikle gönderilir. Süreli onay cevapları sunucuda stale kontrolünden geçer.

Ekran kapalıyken SSE veya WorkManager zamanında bildirim garantisi değildir.
Öneri: isteğe bağlı FCM, yalnızca “Yeni bir güncelleme var” + opaque event kimliği;
mesaj ve dosya içeriği push sağlayıcısına gönderilmez. Gerçek içerik Tailscale HTTPS
üzerinden alınır. FCM için Firebase proje/cihaz yapılandırması ayrıca gerekir;
bu çalışma bunları kurmaz. Cloud push istenmezse uygulama açıldığında uzlaştırma
veya sürekli bildirim gösteren foreground bağlantı modu değerlendirilir; anlık
arka plan teslimi garanti edilmez. Bildirim izni reddi ve force-stop açık UX durumlarıdır.

## UI/UX

- Alt navigasyon: **Asistan** / **Oturumlar**. İlk açılış Asistan; son sohbeti arama yok.
- Üstte bağlantı göstergesi ve **İşler** düğmesi: sayı + bekleyen soru işareti.
- Chat: sakin, okunaklı balonlar; gönderim durumu; dosya önizlemesi; mesaj başına
  en fazla birkaç kısa cümle ve gerekirse “Ayrıntılar / İşi aç / Test et” eylemi.
- Drawer: “Yanıtın gerekiyor”, “Çalışıyor”, “Tamamlananlar”; iş adı, gerçek durum,
  sağlayıcı, son güncelleme. Kanıtsız ilerleme yüzdesi veya tahmini süre yok.
- İş detayı: özet, alt görev ağacı, konuşma, araç olayları, değişen dosyalar;
  doğrudan mesaj ve iptal. İptal kapsamı çocukları içeriyorsa düğmede belirtilir.
- Oturumlar: arama, proje/sağlayıcı filtresi, yeni oturum, harici/uygulama etiketi.
- Soru kartı: iş bağlantısı, kısa soru, seçenekler ve serbest cevap. Aynı anda
  birden fazla bekleyen soru kaybolmaz; drawer ve sohbetten erişilir.
- Erişilebilirlik: ≥48dp dokunma alanı, TalkBack etiketleri, yazı ölçeği, yalnızca
  renge bağlı olmayan durumlar, açık/koyu tema, klavye/safe-area uyumu.

## API ve veri sözleşmesi taslağı

`GET /v1/capabilities`, `/sessions`, `/sessions/:id/messages`, `/assistant`,
`/tasks/:id`; `GET /v1/events?after=cursor` SSE.
`POST /v1/sessions`, `/sessions/:id/messages`, `/assistant/messages`,
`/questions/:id/answers`, `/tasks/:id/cancel`, `/uploads`, `/devices/pair`.
Cursor opaque; timestamp tek başına sayfalama anahtarı değil. Komutlar envelope:
`{clientRequestId, expectedRevision?, ...payload}`. Kabul: `202 {commandId}`.
Aynı anahtar/farklı payload 409. İzin sunucuda çözülür; raw scope RPC açılmaz.

Yeni tablolar: device_grants, session_index, session_leases, assistant_profiles,
assistant_inbox, assistant_deliveries, outbox_events, attachments, mobile_receipts.
Provider kimlikleri composite (provider, nativeId); yerel uygulama kimliği ayrı.
Migration versioned, transaction'lı ve yedeklenebilir; mevcut görev kimlikleri korunur.

## Uygulama sırası ve bitiş ölçütleri

1. **Oturum protokolü:** İki sağlayıcı için keşif/okuma/resume, feature probe,
   normalize mesaj blokları, harici aktiflik politikası. Gerçek geçici konuşmada
   aynı native session ID ile iki tur; bilinmeyen oturum yazması reddedilir.
2. **Güvenilir asistan:** Inbox/outbox, tek tur arbiter, async-only delegasyon,
   sonuç/soru yönlendirme, başlangıç brief'i ve kalıcı profil. Fake driver ile
   yarış/çökme testleri önce; gerçek küçük görevle uçtan uca sonra.
3. **Telefon API'si:** Pairing, HTTPS/Tailscale, SSE replay, upload, idempotency.
   Daemon protokolü telefon istemcisinin permission/source kimliğine güvenmez.
4. **Android dikey dilimi:** Asistan sohbeti, mesaj gönder/al, Room offline,
   işler drawer, çocuk konuşması, oturum listesi/yeni/continue ve dosya.
5. **Günlük kullanım:** Bildirim seçimi, hata ekranları, izin kartları, performans,
   imzalı APK dağıtımı ve kurulum rehberi. Gerçek Android testleriyle kabul.

İlk çalışan kilometre taşı: telefondan A işini başlat → “başladı” al → A sürerken
B hakkında mesaj gönder → A bitince aynı asistan sohbetinde tek sonuç özeti gör.
Ardından soru/yanıt, dosya ve harici oturum devamı eklenir. Bütün özellikleri tek
seferde görselleştirip çalışıyor varsaymak yerine dikey dilimler teslim edilir.

## Kabul ve hata senaryoları

| Senaryo | Beklenen sonuç | Test katmanı |
|---|---|---|
| A sürerken B mesajı | A beklenmez; B inbox'a alınır ve kısa turda işlenir | Controller + gerçek provider |
| Aynı anda üç iş biter | Her sonuç tek kez; uygun kısa birleşik özet | Unit/integration |
| Aynı olay iki kez gelir | İkinci kullanıcı mesajı üretilmez | DB + crash fixture |
| Terminal sonuç transaction'ı sonrası çökme | Outbox yeniden teslim edilir, iş yeniden başlamaz | Process recovery |
| Model çağrısı sonrası receipt öncesi çökme | Uncertain; native geçmişle uzlaştırma | Provider contract |
| Kullanıcı yazarken çocuk sonuçlanır | Tek aktif asistan turu, iki giriş kaybolmaz | Race test |
| İki çocuk soru sorar | Cevap doğru question/task/run'a gider | Controller + UI |
| İptal edilen işe geç cevap | Stale açıkça gösterilir, çocuk yeniden başlamaz | API + UI |
| Child kota / ana asistan kota | Sırasıyla model özeti / deterministik durum kartı | Fixture + canlı kanıt |
| Telefon çevrimdışı veya yanıt kaybolur | Aynı clientRequestId; tek mesaj/tek görev | Network fault |
| SSE cursor eskimiş | Snapshot+watermark; eksik/çift balon yok | API + Room |
| Terminal aynı oturumda yazıyor | Sessiz eşzamanlı yazma yok; conflict/unknown | İki süreç deneyi |
| Native geçmiş bozuk veya cwd silinmiş | Hata izolasyonu; diğer oturumlar açılır | Adapter fixtures |
| Dosya upload yarım/çok büyük/path traversal | Ek tamamlanmaz veya reddedilir | API security |
| Desteklenmeyen görsel/PDF | Açık capability hatası; sessiz veri kaybı yok | Provider contract |
| Token iptal/başka cihaz/yanlış origin | Okuma, yazma, SSE ve upload reddedilir | API security |
| Bilgisayar uyku/restart | Offline gösterimi, sonra kalıcı devam | Gerçek cihaz |
| Android Doze/izin reddi/force-stop | Bildirim sınırı doğru; açılışta veri uzlaşır | Gerçek Android |
| 10k mesaj / büyük tool log | Sayfalama, responsive scroll, kapalı tool detayları | Android benchmark |
| Büyük yazı/TalkBack/klavye/açık-koyu | Kartlar ve composer erişilebilir | Compose + cihaz QA |
| Email/Slack içindeki sahte talimat | Araç izni genişlemez; gönderim kendiliğinden yapılmaz | Adversarial fixtures |

CI: TypeScript check/test + mevcut 34 test; Android JVM/ViewModel testleri, lint,
APK debug build. UI Compose instrumentation ve gerçek telefon QA ayrı raporlanır.
Yerel sırlar, özel asistan tercihleri ve özel konuşmalar public repoya yazılmaz.

## Kaynaklar

- Codex app-server: https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md
- Yerel Claude SDK: `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`, sürüm 0.3.310.
- Tailscale Serve: https://tailscale.com/docs/reference/tailscale-cli/serve
- Android offline-first: https://developer.android.com/topic/architecture/data-layer/offline-first
- Android FCM: https://firebase.google.com/docs/cloud-messaging/android-message-priority

Tasarım önerileri kaynakların garantisi değildir. Gerçek harici oturum takeover,
attachment ve background delivery davranışı kabul testleriyle doğrulanacaktır.
