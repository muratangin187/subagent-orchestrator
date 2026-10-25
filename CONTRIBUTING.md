# Katkıda bulunma

Node.js 22.16+ ve Git gerekir. `npm ci` ile bağımlılıkları kurun.

Değişiklikten önce `AGENTS.md` ve [mimari kararları](docs/architecture.md) okuyun.
Hata düzeltmelerinde hatayı yeniden üreten bir test ekleyin. Sağlayıcı, taşıma,
kalıcı kayıt ve orkestrasyon katmanlarını ayrı tutun.

```sh
npm run format:check
npm run check
npm test
npm run build
npm pack --dry-run
```

Otomatik testler sağlayıcı hesabı veya API anahtarı istemez. `test:live*`
komutları gerçek sağlayıcı girişlerini kullanır, kota tüketebilir ve geçici
dizinlerde dosya oluşturabilir. Bu testleri yalnızca bilerek çalıştırın.

Pull request açıklamasında sorunu, davranış değişikliğini ve test sonuçlarını
belirtin. Özel konuşmaları, erişim anahtarlarını, yerel veritabanını veya müşteri
verilerini paylaşmayın. Yerel test sonucu ile uzak CI sonucunu ayrı belirtin.
