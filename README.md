# Standalone Agent Orchestrator

[![Tests](https://github.com/muratangin187/subagent-orchestrator/actions/workflows/test.yml/badge.svg)](https://github.com/muratangin187/subagent-orchestrator/actions/workflows/test.yml) · [MIT](LICENSE) · [Mimari](docs/architecture.md) · [Doğrulama](docs/verification.md) · [Katkı](CONTRIBUTING.md)

Local MCP orchestration for Codex and Claude Code: durable tasks, nested delegation, async results and explicit permission boundaries.

Claude Code ve Codex alt ajanlarını, MCP destekleyen editörlerden yöneten bağımsız yerel servis. **T3 kurulumu, T3 hesabı veya T3 çalışma zamanı gerektirmez.** Sağlayıcıların kendi oturumlarını ve bilgisayardaki CLI girişlerini kullanır.

Bir görevi arka planda başlatabilir, sonucu bekleyebilir, konuşmasını okuyabilir ve aynı oturuma yeni talimat gönderebilirsiniz. MCP bağlantısı kapansa da yerel servis çalışmaya devam eder. Arayüz bu sürümün kapsamı dışındadır.

## Kurulum

Node.js **22.16 veya üzeri**, macOS veya Linux gerekir. Windows yerel olarak desteklenmez; WSL2 henüz doğrulanmadı. Kullanacağınız sağlayıcının CLI aracını ayrıca kurup oturum açın: `codex login` veya `claude auth login`. Sağlayıcı kullanımı mevcut hesabınızın limitlerine ve ücretlerine tabidir.

Kaynak koddan:

```sh
git clone https://github.com/muratangin187/subagent-orchestrator.git
cd subagent-orchestrator
npm ci
npm run build
npm pack
npm install -g ./standalone-agent-orchestrator-0.1.1.tgz
agent-orchestrator doctor
```

Takım arkadaşınıza `.tgz` dosyasını verin. Onun yalnızca Node, sağlayıcı CLI girişi ve `npm install -g ./standalone-agent-orchestrator-0.1.1.tgz` adımı gerekir. Paket henüz npm kayıt sisteminde yayımlanmadı; `npx standalone-agent-orchestrator` komutunun yayımlanmış bir sürümü indirdiğini varsaymayın.

Servis, ilk MCP bağlantısında otomatik başlar. Çalışma verisi varsayılan olarak `~/.local/share/agent-orchestrator/` altında saklanır. `--home /başka/dizin` ayrı bir servis ve veri alanı oluşturur. Kısa, yerel bir yol kullanın; Unix soket yollarının platforma bağlı uzunluk sınırı vardır. Ağ dosya sistemi kullanmayın.

## Editöre bağlama

Örnekleri kendi proje yolunuza göre üretin:

```sh
agent-orchestrator config --cwd /absolute/path/to/project
```

VS Code `.vscode/mcp.json`:

```json
{
  "servers": {
    "subagent_orchestrator": {
      "type": "stdio",
      "command": "agent-orchestrator",
      "args": ["mcp", "--cwd", "/absolute/path/to/project"]
    }
  }
}
```

Claude Code proje `.mcp.json`:

```json
{
  "mcpServers": {
    "subagent_orchestrator": {
      "command": "agent-orchestrator",
      "args": ["mcp", "--cwd", "/absolute/path/to/project"]
    }
  }
}
```

Codex `~/.codex/config.toml`:

```toml
[mcp_servers.subagent_orchestrator]
command = "agent-orchestrator"
args = ["mcp", "--cwd", "/absolute/path/to/project"]
tool_timeout_sec = 75
```

Editörün PATH değişkeni komutu bulamıyorsa `command` alanına mutlak yolu yazın. `config` komutu örnekleri **yazdırır**; mevcut editör ayarlarınızı değiştirmez. MCP sunucusunu editörde etkinleştirip araç listesini yenileyin.

### Ana oturum kimliği

Varsayılan olarak her MCP süreci farklı bir ana oturum kimliği alır. Yeniden bağlanınca önceki görevlerinizi görmek için aynı `--parent BENZERSIZ_OTURUM_KIMLIGI` değerini kullanın. Kimliği `orchestrator_capabilities` çıktısındaki `scope.id` alanından da alabilirsiniz.

Aynı kimliği bağımsız sohbetlere ortak vermeyin; aksi halde aynı görev listesini paylaşırlar. Proje yolu ve yetki tavanı bu kimliğe ilk kullanımda bağlanır. Bunları değiştiriyorsanız yeni kimlik kullanın. Standart MCP, editörün sohbet kimliğini veya çalışma izinlerini güvenilir biçimde otomatik sağlamaz.

## Kullanım

Ana ajana şu yönergeyi verebilirsiniz:

> Gerektiğinde subagent_orchestrator araçlarını kullan. Önce yetenekleri kontrol et. Her değiştiren çağrı için benzersiz clientRequestId üret; tekrar denerken aynı kimliği ve aynı içeriği kullan. Görevleri kendi başına anlaşılır biçimde yaz. Ana bağlam değişirse send_to_subagent ile aktar. Başka işten döndüğünde get_notifications oku. Sonuçları raporlamadan önce tamamlanma durumlarını doğrula.

Görev oluşturma:

```json
{
  "task": "Bu projenin kimlik doğrulama akışını incele. Dosyaları değiştirme. Üç somut risk ve ilgili dosya yollarını raporla.",
  "provider": "codex",
  "mode": "async",
  "clientRequestId": "auth-review-1"
}
```

`model` alanı sağlayıcının kabul ettiği model kimliğidir; otomatik model değişimi yapılmaz. Ana sohbetten açılan görevde alan boşsa sağlayıcının yerel varsayılanı geçerlidir; iç içe delegasyonda aynı sağlayıcının üst modeli devralınır. Codex'in canlı kataloğunu `agent-orchestrator models` ile okuyabilirsiniz. Bir modelin katalogda bulunması hesabınızın her isteğini kabul edeceği garantisi değildir. `doctor` yalnızca kurulum/sürüm kontrolüdür; gerçek giriş ve model erişimi görev çalıştırılırken doğrulanır.

`mode: "wait"` en fazla 60 saniye bekler. Süre dolması görevi iptal etmez. `wait_for_task` ile yeniden bekleyin. Belirli sonucu takip etmek için `runId` kullanın. Takip mesajı kabul edilirken `commandId` döner; yeni tur kuyruğu işlendiğinde oluşur. Yeni turun `runId` değerini durumdan okuyup onu bekleyin. Önceki tur bitmişse onun sonucunu yeni turun sonucu sanmayın.

`send_to_subagent` seçenekleri:

- `auto`: Codex aktifken yönlendirme; Claude aktifken kuyruk; boşta aynı oturumda yeni tur.
- `steer`: Codex'in aktif turuna yerel protokolüyle talimat ekler. Claude bu seçeneği açıkça reddeder.
- `queue`: Aktif turdan sonra yeni tur başlatır. Sıra kalıcıdır.
- `interrupt_and_restart`: Aktif turu keser, aynı yerel oturumun geçmişiyle yeni tur açar. Baştan farklı bir konuşma oluşturmaz.

`get_subagent_messages` ve `get_notifications` çıktısındaki `nextOffset` değerini sonraki çağrıda `sinceOffset` olarak gönderin. Bildirimler okununca silinmez; her tüketici kendi imlecini tutar. `list_tasks` sayfalarında `nextCursor` değerini `before` olarak kullanın. Son sayfadan sonra boş liste gelir.

## İzinler ve çalışma dizinleri

Varsayılan tavan `read-only` olur. Ana süreç, izinlerini MCP'ye standart biçimde bildirmediği için sistem daha geniş izin tahmin etmez. Yazma için kurulum argümanına açıkça `--ceiling auto-accept-edits` ekleyin; bu ayarı ana oturumun gerçek izinlerinden daha geniş yapmayın. Bir görev veya alt görev tavanını yükseltemez. `--plan`, çocukları salt okunur çalışmayla sınırlar.

- **read-only:** Codex yerel salt okunur sandbox kullanır; Claude yalnızca okuma, arama ve soru araçlarını alır.
- **approval-required:** Bu sürümde temkinli biçimde salt okunura indirilir. Onay vererek yetki yükseltme arayüzü yoktur.
- **auto-accept-edits:** Codex çalışma dizinine yazabilen sandbox kullanır; ağ kapalıdır. Claude proje içindeki Write/Edit işlemlerini yapabilir; kabuk çalıştıramaz. Dışarıdaki dosyalara yönelen yollar denetlenir.
- **full-access:** Açık kurulum tercihi gerektirir. Codex sandbox kısıtını kaldırır; Claude kabuk ve yazma araçlarını alır. İşletim sistemi düzeyinde düşman kod izolasyonu sağlamaz.

`isolation: "worktree"`, görev oluşturulurken yakalanan Git commit'inden ayrı, detached bir checkout açar. Kaydedilmemiş değişiklikler ve bağımlılık dizinleri kopyalanmaz; kurulum betikleri otomatik çalıştırılmaz. Git deposu ve en az bir commit gerekir. Sonuçtaki `cwd` dizini korunur; değişiklikleri inceleyip taşıdıktan sonra `git worktree remove <yol>` ile kaldırabilirsiniz. Sistem değişiklikleri otomatik birleştirmez veya silmez.

Aynı çalışma dizinindeki yazabilen görevler birbirleriyle eşzamanlı çalıştırılmaz. Dışarıdan editörünüzün yaptığı değişiklikleri servis kilitlemez. Bağımsız uygulama görevleri için ayrı worktree tercih edin.

### İş ajanının kendi alt ajanları

İki katmanlı çalışma desteklenir: **ana sohbet → üç iş ajanı → her işin test/uygulama ajanları**. Her çocuk oturuma, yalnızca kendi alt ağacını yönetebilen MCP bağlantısı otomatik verilir. İş ajanı aynı `delegate_task`, `send_to_subagent` ve `wait_for_task` araçlarını kullanır. `parentTaskId` elle vermesi gerekmez; servis bağlar.

Sağlayıcı ve model belirtilmezse çocuk, çağıran ajanın sağlayıcısını ve modelini alır. Başka sağlayıcı seçilirse o sağlayıcının modeli ayrıca verilebilir; mevcut sağlayıcının model kimliği diğerine taşınmaz. İzinler ve plan modu da üst görevden alınır ve genişletilemez. İş ajanı kardeş işlerin görevlerini okuyamaz veya iptal edemez. Ana sohbet kendi ağacının tamamını görev kimliğiyle inceleyebilir; `children` alanı doğrudan alt görevleri listeler.

Sonuç ve bildirimler çağıran iş ajanına döner. İş ajanı bunları birleştirip ana sohbete raporlar. Ana sohbetin kapanması veya üst ajanın turunu bitirmesi çocukları otomatik öldürmez; açık iptal alt ağaca yayılır.

Ana sohbet derinliğe dahil değildir. Varsayılan en fazla üç ajan katmanı ve **katman başına dört** çalışan süreç vardır; toplam üst sınır on ikidir. Üst ajan çocuk sonucunu beklerken `waiting_children` olur. Ayrı katman kotaları sayesinde bekleyen üst ajanlar alt ajanların tüm yuvalarını tüketmez. Aynı dizindeki yazma sırası da bu bekleme sırasında bırakılır. Yazan bir üst ajan çalışırken aynı dizine yazacak asenkron çocuk sırada bekler; üst ajan `wait_for_task` çağırmalı veya çocuk için ayrı worktree seçmelidir. Salt okunur çocuklar eşzamanlı çalışabilir. Bekleme zaman aşımından sonra üst ajan çalışmaya devam edebilir; eşzamanlı dosya değişiklikleri için ayrı worktree kullanın.

Servis başlamadan önce `ORCHESTRATOR_MAX_DEPTH` (1–8) ve `ORCHESTRATOR_CONCURRENCY_PER_DEPTH` (1–16) ile sınırları değiştirebilirsiniz. İlk bağlantının başlattığı servis bu ayarları alır; değişiklik için kendi servisinizi durdurup yeniden başlatın. Derinlik sınırındaki ajana delegasyon bağlantısı verilmez; servis de ayrıca sınırı denetler. Sağlayıcıların izlenmeyen native ajan araçları kapalı kalır.

## Kesinti ve devam etme

MCP köprüsünün kapanması servisi durdurmaz. Servis kapanırsa kayıtlar SQLite'ta kalır. Aktif turun bitip bitmediği kesin bilinmiyorsa durum `recovery_required` olur. Aynı işi otomatik tekrar yürütmez. Önce olayları ve dosyaları inceleyin; ardından açık bir `send_to_subagent` devam mesajı gönderin. Çökme öncesindeki kuyruk mesajları `held`, teslimi belirsiz komutlar `uncertain` olarak `deliveryIssues` içinde görünür. Bunları körlemesine tekrar göndermeyin.

Sağlayıcı süreçleri turlar arasında kapatılır; sonraki turda kalıcı yerel oturum kimliğiyle açılır. Codex aktif tur yönlendirmesi süreç yeniden başlatmadan yapılır. Servis çökmesinden önce yerel oturum kimliğinin kaydı alınamamışsa otomatik bağlanma mümkün değildir.

Sonuçlar **tur başına değişmez**. Görevin son durumu değişebilir; önceki sonuç `runs` içinde korunur. İptal edilmiş göreve devam edilemez; yeni görev açın.

```sh
agent-orchestrator status
agent-orchestrator stop
```

`stop` bu veri alanındaki tüm aktif çocuk süreçleri durdurur. Tek görev için `cancel_task` kullanın. Servis açılışta otomatik başlar; bilgisayar yeniden açıldığında ilk MCP bağlantısına kadar çalışmaz. Sürekli işletim gerekiyorsa `daemon` komutunu kendi launchd/systemd yöneticinize bağlayabilirsiniz.

## Bilinen sınırlar

- Ana sohbet otomatik okunmaz. Bağlam değişikliklerini ana ajan araç çağrısıyla iletir.
- Standart MCP tüm istemcilerde otomatik sohbet uyandırmayı garanti etmez. Bildirim kuyruğu ve bekleme araçları güvenilir yoldur.
- Sorular yalnızca sağlayıcının yapılandırılmış soru aracıyla gelirse beklemeyi keser; düz metindeki soru işaretleri otomatik yorumlanmaz.
- Yetki alanı yerel OS kullanıcısıdır. Aynı kullanıcı altında çalışan kötü niyetli süreçlerden veya düşman koddan koruyan çok kiracılı bir sistem değildir. SQLite/yerel soket paylaşım sunucusu olarak internete açılmaz.
- Varsayılan katman başına dört aktif görev, bin açık görev ve görev başına yüz kuyruk mesajı. Bir tur en fazla otuz dakika çalışır. Model bütçesi/ücret üst sınırı bu sürümde yoktur.
- Mesajlar 64.000 karakterle, saklanan sonuç 128.000 karakterle sınırlıdır. Büyük olaylar kesilme işareti taşır. Native sağlayıcı kayıtları ayrıca kendi dizinlerinde kalır.
- Veriler yerel dosya izinleriyle korunur; şifrelenmez ve otomatik silinmez. Worktree, konuşma ve sonuç kayıtlarının yaşam döngüsünü kullanıcı yönetir.
- macOS'ta gerçek sağlayıcılarla doğrulandı. Linux için CI tanımlıdır; bu teslimde Linux ve WSL üzerinde gerçek model testi yapılmadı.

## Geliştirme ve doğrulama

```sh
npm run check
npm test
npm run test:live
npm run test:live:controls
npm run test:live:nesting
npm pack --dry-run
```

Normal testler gerçek model çağırmaz. `test:live*` yerel sağlayıcı hesabınızı kullanır ve kısa gerçek model çağrıları yapar. Testler geçici çalışma dizinleri oluşturup kendi süreçlerini durdurur. Ayrıntılar: [mimari ve şartname incelemesi](docs/architecture.md), [test kanıtları](docs/verification.md).

### Kota ve hız sınırı bildirimleri

Sağlayıcı kota hatasıyla durduğunda görev `failed` olur. `wait_for_task`,
`get_task_status` ve üst ajanın `get_notifications` çıktısı `failure` alanını
sunar: `kind` (`usage_limit` veya `rate_limit`), `provider`, varsa `resetHint`,
`automaticRetry: false` ve sonraki adım. `resetHint` sağlayıcının özgün ifadesidir;
tarihi belirsiz saatleri kesin zaman damgasına çevirmeyiz. Ham hata da korunur.

O görev için önceden sıraya alınmış mesajlar `held` durumuna alınır; otomatik
tekrar yapılmaz. Limit kalkınca `send_to_subagent` ile yeni, açık bir devam
mesajı gönderin; bekletilen eski mesajlar kendiliğinden çalışmaz. Önceki turun
hata kaydı değişmez. İç içe görevlerde bildirim doğrudan çağıran üst ajana gider.
Üst ajan durumu kullanıcıya raporlamalıdır. MCP bütün istemcilerde sohbeti
kendiliğinden uyandıramaz: üst ajan bildirimleri okumalı veya sonucu beklemelidir.

### Yanlış CLI sürümü veya model görünmüyor

Birden fazla CLI kurulumu varsa `which -a codex` / `which -a claude` ile yolları,
her yol için `--version` ile sürümleri karşılaştırın. MCP sunucusunun ortamına
`ORCHESTRATOR_CODEX_BIN` ve/veya `ORCHESTRATOR_CLAUDE_BIN` değişkenini ekleyerek
kullanılacak çalıştırılabilir dosyanın mutlak yolunu belirtin. Örneğin Codex ayarı:

```toml
[mcp_servers.subagent_orchestrator.env]
ORCHESTRATOR_CODEX_BIN = "/absolute/path/to/codex"
ORCHESTRATOR_CLAUDE_BIN = "/absolute/path/to/claude"
```

Claude Code ve VS Code JSON ayarlarında aynı değişkenleri sunucunun `env`
nesnesine ekleyin. Servis başlangıç ortamını korur: aktif işleri bitirin,
`agent-orchestrator stop` çalıştırın ve MCP bağlantısını yeni ortamla yenileyin.
`stop` çalışan sağlayıcı süreçlerini de durdurur. `doctor` kabuğun PATH'ini,
`models` ise çalışan servisin Codex kataloğunu kontrol eder.
