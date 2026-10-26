const labels = {
  cancel_task: "Görevi durdur",
  send_to_subagent: "Alt ajana mesaj ilet",
  delegate_task: "Yeni görev başlat",
  wait_for_task: "Görev sonucunu bekle",
  get_task_status: "Görev durumunu kontrol et",
  task_status: "Görev durumunu kontrol et",
  get_task_result: "Görev sonucunu al",
  get_notifications: "Gelişmeleri kontrol et",
  answer_subagent: "Alt ajanın sorusunu yanıtla",
  list_tasks: "İşleri listele",
  orchestrator_capabilities: "Cihaz ve yetenekleri kontrol et",
  exec_command: "Komut çalıştır",
  read_file: "Dosyayı oku",
  write_file: "Dosyayı kaydet",
  apply_patch: "Dosyayı düzenle",
  update_plan: "Planı güncelle",
  request_user_input: "Kullanıcıdan bilgi iste",
};
export function toolLabel(title) {
  const value = String(title || "Araç işlemi");
  for (const [key, label] of Object.entries(labels))
    if (
      value === key ||
      value.endsWith("__" + key) ||
      value.endsWith("." + key)
    )
      return label;
  return value;
}
