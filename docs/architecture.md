# Mimari kararlar ve şartname incelemesi

## Sonuç

Şartnamenin temel yönü doğru: ajan döngüsünü yeniden yazmadan, sağlayıcının kalıcı oturumunu yönetmek. Fakat stdio MCP sürecinin tüm çocukların sahibi olması, tur ve görevin tek durum kaydında birleşmesi ve belirsiz komutların otomatik tekrar edilmesi güvenilirliği zedeliyordu. Uygulama bu üç noktayı ayırır.

Akış: **editör → stdio MCP köprüsü → yerel Unix soketi → servis → sağlayıcı adaptörü**. Servis SQLite'ın tek görev yazarıdır. MCP, HTTP üzerinden Unix soketi ve gelecekteki arayüz aynı `Engine` işlevlerini çağırabilir. Her olay artan bir kimlikle kaydedilir; gelecekteki arayüz yeni bir ajan motoruna ihtiyaç duymadan bu kayıtları okuyabilir. Tarayıcı HTTP sunucusu ve arayüz bu sürümde eklenmedi.

## T3 kaynak incelemesi

İncelenen açık kaynak sürüm: [`pingdotgg/t3code`, `5b35402623d7d1d88eaa472807272a6c2e78012a`](https://github.com/pingdotgg/t3code/tree/5b35402623d7d1d88eaa472807272a6c2e78012a).

- [`OrchestratorMcpService.ts`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/apps/server/src/mcp/OrchestratorMcpService.ts): sağlayıcı/ana oturum bazında istek kimliği, yetki tavanı, bekleme, ayrı worktree commit'inin belirlenmesi.
- [`DelegatedCompletionDelivery.test.ts`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/apps/server/src/orchestration-v2/DelegatedCompletionDelivery.test.ts): sonuç yayımlama ve ana oturuma teslimin ayrı sorumlulukları.
- [`ContextHandoffService.ts`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/apps/server/src/orchestration-v2/ContextHandoffService.ts): bağlam aktarma bütçesi ve açık kapsam. Bu uygulamada geçmişi otomatik kopyalamamak tercih edildi.
- [`CodexAdapterV2.ts`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts) ve [`ClaudeAdapterV2.ts`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts): sağlayıcı sınırında protokol ve izin çevirisi; Claude query/resume ve kesme yaşam döngüsü.

T3 kaynakları referans olarak okundu; çalışma zamanı kodu veya T3 paketleri bu projeye taşınmadı. Şartnamede geçen `#20348` hatasının tarihçesi bağımsız olarak doğrulanmadı; bu numara tasarım kanıtı olarak kullanılmadı.

Sağlayıcı protokolü ayrıca [OpenAI app-server belgesi](https://learn.chatgpt.com/docs/app-server), kurulu Codex'in ürettiği TypeScript protokol tanımları ve kurulu Claude Agent SDK tipleri üzerinden kontrol edildi. CLI sürümleri değiştiğinde adaptör sözleşme testleri ve canlı testler yeniden çalıştırılmalı.

## Şartnamedeki boşluklar ve uygulanan kararlar

| Konu | Karar ve gerekçe |
|---|---|
| MCP sürecinin ömrü | Çocukları bağımsız servis sahiplenir. Editör bağlantısı kesilince iş devam eder. |
| Görev ve tur | Görev konuşmanın kimliğidir; her devam mesajı yeni bir tur oluşturabilir. Sonuçlar tur başına değişmez. |
| İstek tekrarları | `(owner, operation, clientRequestId)` benzersizdir. Aynı anahtar/farklı içerik çatışma üretir. Yerel kabul ve fiş aynı SQLite işlemindedir. |
| Dış sistemde tam bir kez çalışma | Sağlayıcı RPC'si ve SQLite arasında ortak transaction yoktur. Belirsiz yan etkiler otomatik tekrarlanmaz; `uncertain/recovery_required` görünür olur. Uçtan uca exactly-once iddiası yoktur. |
| Çoklu istemci | Unix soketi üzerinden tek servis. Servis sahipliği SQLite `BEGIN IMMEDIATE` içinde canlı PID kontrolü ve benzersiz sahiplik değeriyle alınır. Aynı anda yeniden başlatma iki yürütücü oluşturmaz. |
| Yetki mirası | MCP'den gerçek ana izinleri öğrenilemez. Kullanıcının belirlediği sabit tavan + salt okunur varsayılan. Çocuk görevin talebi tavanı yükseltemez. |
| Sağlayıcı farkları | Codex yerel steer; Claude açık kuyruk veya kes/devam et. Desteklenmeyen mod sessizce başka moda çevrilmez. |
| Bekleme | Bekleme sonucu gözlemler; zaman aşımı iptal anlamına gelmez. Yapılandırılmış soru beklemeyi bitirir. |
| Kesinti kurtarma | Oturum kimliği ve olaylar korunur; belirsiz aktif iş açık devam ister. Eski kuyruk mesajları onay sayılmaz. |
| Sonuç bildirimi | Kalıcı, imleçli bildirimler. Ana sohbeti otomatik uyandırma ürün/harness özelliğidir; standart MCP garantisi değildir. |
| Bağlam değişikliği | `send_to_subagent` ile açık aktarım. Gizli editör geçmişi okuma veya dosya üzerinden oturum tahmini yapılmaz. |
| Dosya yarışları | Ortak dizindeki yazan görevleri sırala; isteğe bağlı commit tabanlı worktree. Dış editör değişikliklerine karşı kilit iddiası yok. |
| Alt görev ağacı | Her çocuğa kendi görevine bağlı MCP bağlantısı verilir; çocuk da parent olur. Varsayılan üç seviye, katman başına ayrı kota. Yetki ve model mirası sunucuda çözülür; kardeş ağaca erişim reddedilir. İptal ağaca yayılır. Native izlenmeyen delegasyon kapalı kalır. |
| Arayüz hazırlığı | Transport, engine, store ve adaptörler ayrıdır. Yapılandırılmış olaylar ve imleçler ileride görüntüleme API'sine temel olur. |

## Operasyonel sınırlar

Bu, tek makinede aynı OS kullanıcısına ait güvenilir geliştirme oturumları içindir. Aynı kullanıcıya karşı güvenlik sınırı değildir. Root erişimi, gizli anahtar kasası, uzak istemci kimlik doğrulaması, ağ hizmeti, tam süreç ağacı izolasyonu ve konteyner sandbox bu kapsamda değildir.

Codex'in yerel yapılandırması kullanılabilir; bilinen kullanıcı düzeyi MCP sunucuları kapatılır ve native çoklu ajan özelliği devre dışı bırakılır. Proje/kuruluş düzeyindeki sağlayıcı davranışları veya bir kabuk aracılığıyla başlatılan bağımsız süreçler ayrı bir güven sınırıdır. Claude'da kullanıcı/proje ayar kaynakları ve dış MCP sunucuları yüklenmez; yalnızca göreve bağlı dahili delegasyon MCP'si eklenir; araç listesi açık verilir. Bunlar kasıtlı düşman kodu çalıştırmak için yeterli bir sandbox değildir.

SQLite şema sürümü denetlenir. Yabancı anahtarlar, WAL, FULL synchronous ve transaction kullanılır. Kalıcı olaylar tanı koymayı kolaylaştırır; tam olaylardan yeniden inşa edilen bir event-sourcing sistemi olduğu iddia edilmez. Mevcut durum, tur ve olay kayıtları aynı commit içinde güncellenir.

İleride arayüz eklenirken önce kimlik doğrulamalı yerel API ve yalnızca okuma görünümü eklenmeli. MCP köprüsü veya model adaptörlerini UI bileşenlerine taşımaya gerek yoktur.

## İç içe delegasyon ve bekleme

Katman başına ayrı süreç kotası, tek global semaforun doğurduğu kilitlenmeyi önler: bütün iş ajanları çocuk beklerken test ajanlarına yine çalışma yuvası kalır. Sınır `maxDepth × concurrencyPerDepth` süreçtir. Bir ajan yalnızca aşağı doğru kendi soy ağacını bekleyebilir; kardeş/üst görevlere erişemez. Çalışma dizini için bekleyen üst ajanın yazma sırası bırakılır. Bu mekanizma harici editörlere karşı dosya kilidi değildir.

Codex ve Claude alt oturumuna aynı CLI'nin stdio MCP köprüsü eklenir. Köprüdeki görev kimliği araç argümanı değildir; sağlayıcı başlatılırken sabitlenir. Servis alt scope'un dizin, yetki ve plan modunu görev kaydından çözer; istemcinin ileri sürdüğü daha geniş tavanı kullanmaz. Codex yalnızca bu dahili sunucunun araç onaylarını otomatik kabul eder. Sandbox veya harici MCP yetki artışları kabul edilmez.
