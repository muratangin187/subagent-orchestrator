---
name: agent-workspace
description: Implement, debug, test and install changes to the standalone Agent Workspace / subagent-orchestrator project, including its macOS Electron app, Android app, Even G2 companion and Mac–XPS coordinator. Use for requests such as “Agent Workspace'te şunu değiştir”, chat UI, model/reasoning selection, queue/steer, file previews/downloads, usage indicators, voice, device routing, or app releases. Not for unrelated Madlen product repositories or merely delegating a coding task.
---

# Agent Workspace geliştirme

Kullanıcının bu beceriden sonra yazdığı isteği görev olarak ele al. Önceki sohbetin
bağlamını bildiğini varsayma. Sadece öneri sunmakla kalma: değiştir, doğrula,
etkilenen bileşenleri güvenle kur ve kaynak değişikliklerini GitHub'a gönder.
Kullanıcı yalnızca inceleme/plan istiyorsa veya kurulum/push istemiyorsa o sınırı koru.
Beceri izin tavanını yükseltmez; imkânsız veya belirsiz adımı olmuş gibi gösterme.

## Başlangıç

1. Varsa `~/.config/agent-workspace/maintenance.json` dosyasını oku. Yalnızca
   yollar/cihaz adları içeren yerel kurulum profilidir; kimlik bilgisi değildir.
   Yoksa becerinin bulunduğu Git deposunu veya kullanıcının belirttiği checkout'u kullan.
2. Hedef depoda `AGENTS.md`, `CLAUDE.md` ve etkilenen alt dizin talimatlarını oku.
   `git status --short`, dal ve remote'u kontrol et. Kullanıcının başka değişikliklerini
   silme, stash/reset yapma veya kendi commit'ine katma. Çalışan sunucu dizinini
   kaynak checkout sanma; Git değilse geliştirmeyi Git checkout'unda yap.
3. [Proje haritasını](references/project.md) oku. Kurulum için ayrıca
   [teslim akışını](references/delivery.md) oku. Güncel kaynak bu notlardan üstündür.
4. UI isteği genel ise Mac ve Android karşılıklarını birlikte ele al. G2'yi yalnızca
   etkileniyorsa değiştir. Sesli asistan geliştirmek, sesli cevap vermeye izin değildir.

## Uygulama

- T3'ten davranış örneği alınabilir; T3 runtime bağımlılığı ekleme. Lisansı gözet.
- Tek kalıcı asistan koordinatördedir. Worker cihazları ve UI istemcileri ayrı süreçlerdir.
  İstemciyi kapatmak işleri durdurmaz; koordinatör yeniden başlatması durdurabilir.
- Normal mesaj `queue` olsun. Yalnızca açık kullanıcı eylemi mevcut kuyruk komutunu
  `steer` moduna taşısın; kopya mesaj üretme. Claude'u gizlice kesip yeniden başlatma.
- Yan etkili çağrılarda sabit request ID ile aynı isteği tekrar et; aynı ID'yi farklı
  içerikle kullanma. Belirsiz teslim veya recovery_required durumunu körlemesine oynatma.
- Sağlayıcı/model listesini canlı katalogdan al. Uydurma model alias'ı üretme.
  Sağlayıcı geçişini mevcut handoff akışı üzerinden yap.
- Mesaj/araç olaylarının zaman sırasını koru; alt görev etkinliğini ana turun durumu
  sanma. Kullanım göstergeleri **kalan** kotadır; bilinmeyeni %100 veya %0 gösterme.
- Yeni gateway endpoint'i ekliyorsan Electron `policy.cjs` allowlist'ini, tipleri,
  istemcileri ve yetkilendirme testlerini birlikte kontrol et.
- Dosya linkini shell komutuna dönüştürme. Cihaz kökü, gizli dosya/symlink denetimleri,
  sınırlı parça aktarımı ve HTML izolasyonu korunmalı. İndirme kurulum/çalıştırma değildir.
- Keychain, API anahtarı, SSH/provider token'ı ve imza dosyası içeriğini yazdırma veya
  Git'e ekleme. Sistem güvenlik penceresini kullanıcı onaylar; atlatmaya çalışma.

## Doğrulama ve teslim

- Depo gereği `npm run check`, `npm test`, `npm run build` çalıştır.
  Etkilenen uygulamanın build/lint/test adımlarını teslim rehberinden seç.
- İşlevsel hata/yarış durumuna anlamlı regresyon testi ekle. Basit renk/metin değişikliği
  için uygulamayı taklit eden test üretme. Geçen testleri sebepsiz tekrar tekrar çalıştırma.
- Gerçek kayıtları yalnızca gerekli, sınırlı, salt okunur kapsamda incele. UI testinde
  yeni küçük QA oturumu/fixture kullan; kullanıcının aktif işine test mesajı gönderme.
- Cihaz kontrolünde mevcut ortamın phones/Argent talimatlarını izle. Cihazı keşfet;
  eski ADB seri numarası veya süreç PID'sini kopyalama. Arama/kilit/kişisel kullanım
  görürsen dur. Simülatöre geçiş için gereken onayı varsayma.
- Build/otomatik test ile gerçek UI doğrulamasını ayrı raporla. Test edilmemiş ekranı
  çalışıyor diye sunma. Keychain engeli bağımsız geliştirme/testi durdurmasın.
- İlgili paketi kur; istemci değişikliğinde sunucuyu gereksiz yeniden başlatma.
  Aktif sunucu işleri için teslim rehberindeki bakım kararını uygula.
- Diff'i ve staged dosyaları gözden geçir; sadece görev dosyalarını commit et ve
  mevcut hedef dala push et. Force-push, merge, npm publish ve public binary release
  bu becerinin varsayılan kapsamı değildir. PR oluşturulursa host'un PR bağlama kuralını uygula.
- Sonucu kısa Türkçeyle ver: ne değişti, hangi cihaza gerçekten kuruldu, hangi
  doğrulama yapıldı ve varsa kalan engel. Commit/dal bağlantısını ekle.
