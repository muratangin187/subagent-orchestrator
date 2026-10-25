# Doğrulama kaydı

Doğrulama ortamı: macOS, Node `22.20.0`, Codex CLI `0.146.1`, Claude Code `2.1.309`. Tarih: 25 Ekim 2026. Test girdileri bu çalışma için oluşturuldu; gerçek üretim verisi veya özel müşteri konuşması kullanılmadı. Sağlayıcı testleri gerçek yerel CLI oturumları ve mevcut girişlerle çalıştı.

## Otomatik regresyonlar

`npm test` gerçek model çağırmadan durum makinesini, SQLite'ı, gerçek süreçleri ve MCP protokolünü denetler. Kapsam:

- Eşzamanlı yinelenen isteklerin tek görev oluşturması; aynı anahtar/farklı içerik çatışması.
- Ana oturumlar arasında görev erişiminin ayrılması.
- Bekleme zaman aşımının iptal etmemesi; önceki tur sonuçlarının değişmemesi.
- Kuyruk sırası, tekrar gönderilen mesaj, aktif yönlendirme ve kes/devam et.
- Soru bekleme, doğru yanıt, geçersiz yanıt ve eski soru kimliğinin reddi.
- Yetki ve plan modu tavanı; yol dışına yazma ve sembolik bağlantı kaçışının reddi.
- Alt ağaç iptali, kuyruk temizleme ve geç gelen başarının iptal sonucunu değiştirmemesi.
- Derinlik kotası ve katman başına eşzamanlı çalışma.
- Aynı dizindeki bağımsız yazan görevlerin sıraya alınması.
- Unicode olay verisi, olay/bildirim imleci ve veritabanını yeniden açma.
- Aktif daemon sürecini SIGKILL ile durdurma; yeniden başlatma, otomatik tekrar yapmama ve açık devamla aynı native oturuma dönme. Bu hata testi protokol uyumlu yerel sağlayıcı fixture'ı kullanır; ücretli bir modelin çökme davranışını taklit ettiği iddia edilmez.
- Çökmeden önceki kuyruk mesajlarının kurtarma izni sayılmaması.
- Unix soket/dizin izinleri; MCP SDK ile gerçek initialize/list/call akışı.
- MCP köprüsü kapandıktan sonra servisin çalışması; aynı anda açılan köprülerin tek servise bağlanması.
- Git worktree'nin yakalanmış commit'i kullanması, kaydedilmemiş ana değişiklikleri taşımaması ve çocuk dosyalarını koruması.
- Aynı milisaniyede oluşturulan görevlerin sayfalama sırasında kaybolmaması.
- Çocuğun kendi alt ajanını başlatması; kardeş işe erişimin ve yetki yükseltmenin reddi.
- Üç iş ajanının aynı anda beklerken üç test ajanının ilerlemesi.
- Aynı sağlayıcıda model/effort mirası; sağlayıcı değişince yanlış model kimliğinin taşınmaması.

Eşzamanlı servis başlatma için ayrıca üç istemciyle on ayrı tur çalıştırıldı; hepsi tek servise bağlandı. Bu kontrol sırasında tespit edilen SQLite ilk açılış kilit yarışı, başlangıç bekleme ayarı ve sınırlı tekrar ile düzeltildi.

## Gerçek sağlayıcı senaryoları

`npm run test:live`:

- Codex ve Claude geçici `fixture.json` dosyasındaki 37 ve 48 puanlarını okuyup toplam 85 sonucunu verdi.
- Takip turu aynı native oturum kimliğiyle çalıştı ve önceki 85 sonucunu hatırladı.
- İlk turun sonucu korunurken ikinci tur sonucu ayrı kaydedildi.
- Her iki sağlayıcının konuşma ve araç olayları kalıcı kayıttan okundu.

`npm run test:live:controls`:

- Aktif Codex turuna `steer` gönderildi; sonuç `ORIGINAL` yerine `STEERED` oldu ve tek tur kaldı.
- Aktif Codex görevi iptal edildi; durumu `cancelled` oldu.
- Her iki sağlayıcı yazma izniyle gerçek geçici dosya oluşturdu.
- Her iki sağlayıcı salt okunur modda istenen dosyayı oluşturamadı; dosyanın gerçekten yok olduğu kontrol edildi.

`npm run test:live:nesting`:

- Codex iş ajanı, MCP aracıyla gerçek bir Claude çocuğu başlatıp `CHILD=45` sonucunu aldı; `PARENT_RECEIVED=45` olarak raporladı.
- Claude iş ajanı aynı akışı gerçek Codex çocuğuyla tamamladı.
- Ağaç kaydında tam bir çocuk, doğru sağlayıcı, derinlik iki ve tamamlanmış sonuç görüldü. Yalnızca ana modelin cevabına bakılarak başarılı sayılmadı.

Codex model testinde canlı katalogda varsayılan olarak sunulan `gpt-5.6-sol` kullanıldı. İlk denemede makinenin yerel varsayılanı olan `gpt-6-astra`, kurulu CLI için sunucu tarafından sürüm uyumsuzluğu nedeniyle reddedildi. Sistem bu hatayı görev kaydına yazdı; modeli sessizce değiştirmedi. Sonraki test açıkça katalogdaki modeli seçti. Claude testleri yerel varsayılan modeli kullandı.

## Paket ve sınırlar

TypeScript kontrolü, biçim kontrolü ve npm paketleme yapılır. Kurulabilir `.tgz`, geçici bir npm prefix'ine kurularak CLI ve MCP bağlantısı denenir; kişisel/global editör ayarları değiştirilmez.

Bu kayıt kapsamındaki canlı testler macOS içindir. Linux ve WSL canlı sağlayıcı testi, VS Code/Claude Code arayüzünde elle bağlantı, uzun süreli yük testi, sağlayıcı kota tükenmesi ve tam makine yeniden başlatması bu teslimde doğrulanmadı. CI macOS ve Linux üzerinde Node 22/24 için tanımlıdır; uzak CI çalıştırıldığı iddia edilmez. Yapılandırılmış soruların otomatik testi vardır; sağlayıcı modellerinin her zaman soru aracını seçeceği garanti edilmez.

## Son tekrar sırasında görülen gerçek kota hatası

İki katmanlı canlı testlerin başarılı tamamlanmasının ardından, temel/izin testlerini son sürümde tekrar çalıştırırken Claude hesabı oturum limitine ulaştı. Codex kontrolleri tekrar geçti; Claude aşamaları bu nedenle tamamlanmadı. Önceki başarılı Claude sonuçları bu sınırlamayla birlikte değerlendirilmelidir.

Gerçek SDK çıktısı `subtype: success` ile birlikte `is_error: true` gönderiyordu. Adaptör yalnızca subtype'a bakınca kota metnini başarılı sonuç sayıyordu. `is_error` kontrolü eklendi; yakalanan gerçek veri şekli regresyon testine alındı. Kota ve kimlik doğrulama hataları artık başarısız görev olarak kaydedilir. Limit sonrası yeni bir başarılı Claude model turu doğrulanmış değildir.

Düzeltmeden sonra gerçek kota yanıtı motor üzerinden yeniden doğrulandı: durum `failed`, hata `Claude HTTP 429: ... session limit`. Son otomatik koşum **31/31** geçti. Paket ayrı bir npm prefix'ine kuruldu; kurulan komutla MCP initialize/list/call akışı tamamlandı ve 10 araç, üç katman sınırı, toplam 12 sağlayıcı süreci üst sınırı doğru döndü.
