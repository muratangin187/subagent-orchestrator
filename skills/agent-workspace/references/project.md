# Proje haritası

Bağımsız depo: `muratangin187/subagent-orchestrator`. Node 22.16+ / TypeScript.
`package.json` ve lockfile sürümleri otoritedir. Bu proje Madlen öğretmen uygulaması
değildir; Madlen deploy/Linear/Slack iş akışlarını otomatik uygulama.

| Katman | Kaynaklar |
|---|---|
| Durum / kuyruk / yürütme | `src/engine.ts`, `src/store.ts`, `src/schema.ts` |
| Kalıcı asistan | `src/workspace/controller.ts` |
| Kimlik doğrulamalı HTTP API | `src/workspace/gateway.ts` |
| SSH worker / cihaz kayıtları | `src/devices/worker.ts`, `query.ts`, `registry.ts` |
| Sağlayıcılar / model kataloğu / kota | `src/providers/` |
| Yerel dosya okuma | `src/workspace/artifacts.ts` |
| Desktop React UI | `apps/desktop/src/main.tsx`, `UsageLimits.tsx`, `AttachmentPreview.tsx` |
| Desktop güven sınırı | `apps/desktop/electron/main.cjs`, `preload.cjs`, `policy.cjs` |
| Android Compose | `apps/android/app/src/main/java/dev/agentworkspace/` |
| Android veri/Markdown/ekranlar | `WorkspaceModel.kt`, `Repository.kt`, `MainActivity.kt`, `MarkdownMessage.kt`, `AttachmentViewer.kt`, `UsageLimits.kt` |
| Gözlük | `apps/even-g2/`, `docs/even-g2.md` |

İlgili belgeler: `docs/architecture.md`, `docs/multi-device.md`,
`docs/android-workspace.md`, `docs/provider-handoff.md`, `docs/chat-progress.md`,
`docs/android-release.md`, `docs/verification.md`.

## Durum anlamı

- Koordinatör SQLite veritabanı task/run/event geçmişinin otoritesidir. UI ayrı process.
- XPS varsayılan/kalıcı koordinatör olabilir; gerçek kimlikleri `devices.json` veya
  `/v1/state` üzerinden doğrula. Oturum cihazını sessizce değiştirme.
- `workspace_inputs` kabul durumu, engine `commands` kuyruğu ve provider'ın aktif
  turu farklıdır. Bir mesajın chatte görünmesi aktif modele iletildiğini kanıtlamaz.
- Başlıklar/özetler en az kotası kalan dönemi gösterir. Backend `usedPercent` alanı
  kullanılan değerdir; UI `100 - usedPercent` gösterir. Alanın anlamını backend'de tersine çevirme.
- Dosyalar önce seçili cihazda, sonra diğer kayıtlı cihazlarda aranır. Mevcut sınırlar:
  512 MiB indirme, 4 MiB parçalar, 5 MiB önizleme; kaynakta yeniden kontrol et.
- APK/bilinmeyen tür indirilir, çalıştırılmaz. Markdown önizlemesi kaynak dosyayı
  değiştiren editör değildir. HTML ağ/dosya/bridge erişimini açma.

## Yeni API kontrolü

Gateway route + ownership/auth + request kimliği; gerekiyorsa worker query;
Electron allowlist + preload/types; Android repository/model; ilgili docs/test.
Sadece web geliştirme sunucusunda geçen çağrıyı packaged Electron'da da doğrula.
