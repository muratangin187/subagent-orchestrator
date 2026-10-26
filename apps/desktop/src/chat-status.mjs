export function chatStatus({
  task,
  delivery,
  offline,
  connected,
  activeChildren = 0,
}) {
  if (!connected)
    return {
      kind: "warning",
      label: "Bağlantı bekleniyor",
      detail: "Mesaj göndermek için bilgisayarına bağlan.",
    };
  if (offline)
    return {
      kind: "warning",
      label: "Bağlantı kesildi",
      detail:
        "İş sunucuda devam ediyor olabilir. Durum yeniden bağlanınca güncellenecek.",
    };
  const pending =
    delivery &&
    (delivery.phase === "sending" ||
      task?.runId === delivery.previousRunId ||
      !task);
  if (pending && delivery.phase === "uncertain")
    return {
      kind: "warning",
      label: "Gönderim doğrulanamadı",
      detail:
        "Mesaj ulaşmış olabilir. Yeniden göndermeden önce sohbeti kontrol et.",
    };
  if (pending)
    return {
      kind: "working",
      animated: true,
      label:
        delivery.phase === "sending"
          ? "Mesaj gönderiliyor…"
          : "Mesaj alındı · Yanıt bekleniyor…",
      detail: "Yanıt burada görünecek. Bu sırada başka bir mesaj yazabilirsin.",
    };
  if (["running", "starting", "queued", "waiting"].includes(task?.status))
    return {
      kind: "working",
      animated: true,
      label:
        task.status === "queued"
          ? "Mesaj sırada…"
          : "Asistan yanıt hazırlıyor…",
      detail: "Yanıt burada görünecek. Bu sırada başka bir mesaj yazabilirsin.",
    };
  if (task?.status === "waiting_question")
    return {
      kind: "warning",
      label: "Yanıtın gerekiyor",
      detail: "Yukarıdaki soruyu yanıtladığında devam edecek.",
    };
  if (task?.status === "recovery_required")
    return {
      kind: "warning",
      label: "Kontrol gerekiyor",
      detail: "İşin sonucu belirsiz. Otomatik tekrar başlatılmadı.",
    };
  if (task?.status === "failed")
    return {
      kind: "warning",
      label: "Yanıt hazırlanamadı",
      detail: "Çalışma akışındaki hata ayrıntısını kontrol et.",
    };
  if (task?.status === "cancelled")
    return {
      kind: "idle",
      label: "İş iptal edildi",
      detail: "Yeni bir mesaj gönderebilirsin.",
    };
  if (activeChildren)
    return {
      kind: "working",
      animated: true,
      label: `${activeChildren} iş arka planda sürüyor`,
      detail: "Sonuç geldiğinde asistan bu sohbette haber verecek.",
    };
  return {
    kind: "idle",
    label: task ? "Yanıt tamamlandı" : "Mesajını bekliyorum",
    detail: task
      ? "Yeni bir mesaj gönderebilirsin."
      : "Ne yapmak istediğini yaz.",
  };
}
