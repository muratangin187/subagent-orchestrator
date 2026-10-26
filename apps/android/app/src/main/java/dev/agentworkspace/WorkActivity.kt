package dev.agentworkspace

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.json.JSONObject

/** Shared presentation comes from the server; this reducer only applies item patches. */
data class WorkActivityItem(val id: String, val kind: String = "tool", val title: String = "Araç", val state: String = "running", val input: String = "", val output: String = "")
data class WorkActivityRun(val id: String, val start: Long = 0, val end: Long = 0, val state: String = "running", val items: List<WorkActivityItem> = emptyList(), val order: Long = 0)
fun workActivityRuns(events: List<JSONObject>): Map<String, WorkActivityRun> {
    val runs = linkedMapOf<String, WorkActivityRun>()
    events.forEach { event ->
        val runId = event.optString("runId")
        if (runId.isBlank()) return@forEach
        var run = runs[runId] ?: WorkActivityRun(runId)
        val type = event.optString("type")
        if (type == "run_started") run = run.copy(start = event.optLong("created"))
        if (type in listOf("completed", "failed", "cancelled")) run = run.copy(end = event.optLong("created"), state = type)
        event.optJSONArray("activity")?.objects()?.forEach { patch ->
            val id = patch.optString("id")
            val old = run.items.find { it.id == id } ?: WorkActivityItem(id)
            val item = old.copy(
                kind = patch.optString("kind", old.kind), title = patch.optString("title", old.title),
                state = patch.optString("state", old.state), input = patch.optString("input", old.input),
                output = if (patch.optString("append") == "output") (old.output + patch.optString("output")).takeLast(48000) else patch.optString("output", old.output),
            )
            run = run.copy(items = if (run.items.any { it.id == id }) run.items.map { if (it.id == id) item else it } else run.items + item)
        }
        runs[runId] = run
    }
    return runs.mapValues { (_, run) -> if (run.end > 0) run.copy(items = run.items.map { if (it.state == "running") it.copy(state = "interrupted") else it }) else run }
}

fun workActivitySegments(events: List<JSONObject>): Map<String, WorkActivityRun> {
    val runs = workActivityRuns(events)
    val segments = linkedMapOf<String, WorkActivityRun>()
    val owners = mutableSetOf<String>()
    val segmentRuns = mutableMapOf<String, String>()
    val finished = mutableMapOf<String, Long>()
    val runsWithActivity = mutableSetOf<String>()
    var current: String? = null
    var currentRun = ""
    events.forEach { e ->
        val type = e.optString("type")
        val p = e.optJSONObject("payload") ?: JSONObject()
        if (type in listOf("assistant_message", "assistant_delta", "provider_handoff", "question") ||
            (type in listOf("task_created", "message_queued") && !p.optString("displayText", p.optString("message", p.optString("task"))).startsWith("Background task event"))) current = null
        val runId = e.optString("runId")
        e.optJSONArray("activity")?.objects()?.forEach patchLoop@ { patch ->
            val itemId = patch.optString("id")
            runsWithActivity.add(runId)
            if (patch.optString("state") in listOf("completed", "failed")) finished["$runId:$itemId"] = e.optLong("created")
            if (owners.add("$runId:$itemId")) {
                val run = runs[runId] ?: return@patchLoop
                if (current == null || currentRun != runId) {
                    current = "work-${e.optLong("id")}"; currentRun = runId
                    segmentRuns[current!!] = runId
                    segments[current!!] = run.copy(id = current!!, start = e.optLong("created"), items = emptyList(), order = e.optLong("id"))
                }
                val group = segments[current!!]!!
                segments[current!!] = group.copy(items = group.items + run.items.filter { it.id == itemId })
            }
        }
    }
    runs.forEach { (runId, run) ->
        if (runId !in runsWithActivity) {
            events.find { it.optString("runId") == runId && it.optString("type") == "run_started" }?.let {
                val id = "work-${it.optLong("id")}"
                segments[id] = run.copy(id = id, order = it.optLong("id"))
            }
        }
    }
    return segments.mapValues { (_, group) ->
        if (group.items.isNotEmpty() && group.items.all { it.state in listOf("completed", "failed") }) {
            val end = group.items.maxOfOrNull { finished["${segmentRuns[group.id]}:${it.id}"] ?: group.end } ?: group.end
            group.copy(end = end, state = if (group.items.any { it.state == "failed" }) "failed" else "completed")
        } else group
    }.toList().sortedBy { it.second.order }.toMap()
}

@Composable
fun WorkActivityGroup(run: WorkActivityRun) {
    var manual by remember(run.id) { mutableStateOf<Boolean?>(null) }
    val expanded = manual ?: (run.end == 0L)
    Column(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
        Row(Modifier.fillMaxWidth().clickable { manual = !expanded }.padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(if (expanded) Icons.Default.ExpandMore else Icons.Default.ChevronRight, "Çalışma ayrıntıları", Modifier.size(18.dp), tint = MaterialTheme.colorScheme.secondary)
            Spacer(Modifier.width(8.dp))
            WorkingTime(run.start, run.end)
            Spacer(Modifier.weight(1f))
            Text("${run.items.size} işlem", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.secondary)
        }
        if (expanded) {
            Column(Modifier.padding(start = 12.dp).heightIn(max = 320.dp).verticalScroll(rememberScrollState())) {
                if (run.items.isEmpty()) Text(if (run.end == 0L) "Sağlayıcıdan yanıt bekleniyor…" else "Bu turda araç etkinliği yok.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.secondary)
                run.items.forEach { item -> key(item.id) { WorkActivityRow(item) } }
            }
        } else if (run.items.isNotEmpty()) {
            Text("${friendlyToolLabel(run.items.last().title)} · ${if (run.state == "failed") "Hata" else if (run.state == "cancelled") "İptal" else "Tamamlandı"}", Modifier.padding(start = 26.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.secondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}
@Composable
private fun WorkActivityRow(item: WorkActivityItem) {
    var expanded by remember(item.id) { mutableStateOf(false) }
    val icon = when (item.kind) {
        "command" -> Icons.Default.Terminal
        "read" -> Icons.Default.Description
        "edit" -> Icons.Default.EditNote
        "search" -> Icons.Default.Search
        "thinking" -> Icons.Default.Psychology
        else -> Icons.Default.Build
    }
    val color = if (item.state == "failed") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.secondary
    Column {
        Row(Modifier.fillMaxWidth().clickable { expanded = !expanded }.padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null, Modifier.size(17.dp), tint = color)
            Spacer(Modifier.width(8.dp))
            Column(Modifier.weight(1f)) {
                Text(friendlyToolLabel(item.title), style = MaterialTheme.typography.bodySmall, color = color)
                val preview = item.input.ifBlank { item.output }.replace('\n', ' ')
                if (preview.isNotBlank()) Text(preview, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (item.state == "running") CircularProgressIndicator(Modifier.size(12.dp), strokeWidth = 1.5.dp)
            else Icon(if (item.state == "failed") Icons.Default.ErrorOutline else if (item.state == "completed") Icons.Default.Check else Icons.Default.Remove, null, Modifier.size(14.dp), tint = color)
            Icon(if (expanded) Icons.Default.ExpandMore else Icons.Default.ChevronRight, null, Modifier.size(16.dp), tint = color)
        }
        if (expanded) Surface(shape = RoundedCornerShape(6.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh) {
            Column(Modifier.fillMaxWidth().padding(12.dp)) {
                if (item.input.isNotBlank()) { Text("GİRDİ", style = MaterialTheme.typography.labelSmall); SelectionContainer { Text(item.input, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall) }; Spacer(Modifier.height(12.dp)) }
                if (item.output.isNotBlank()) {
                    if (item.kind == "thinking") MarkdownMessage(item.output)
                    else { Text("ÇIKTI", style = MaterialTheme.typography.labelSmall); SelectionContainer { Text(item.output, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall) } }
                } else Text(if (item.state == "running") "Sonuç bekleniyor…" else "Bu işlem için çıktı kaydedilmedi.", style = MaterialTheme.typography.bodySmall)
                if (item.state == "interrupted") Text("Tamamlanma olayı alınmadı.", style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

fun friendlyToolLabel(value: String): String {
    val labels = mapOf("html_preview" to "Görseli önizle", "html_render" to "Görseli sohbette göster", "cancel_task" to "Görevi durdur", "send_to_subagent" to "Alt ajana mesaj ilet", "delegate_task" to "Yeni görev başlat", "wait_for_task" to "Görev sonucunu bekle", "get_task_status" to "Görev durumunu kontrol et", "task_status" to "Görev durumunu kontrol et", "get_task_result" to "Görev sonucunu al", "get_notifications" to "Gelişmeleri kontrol et", "answer_subagent" to "Alt ajanın sorusunu yanıtla", "list_tasks" to "İşleri listele", "orchestrator_capabilities" to "Cihaz ve yetenekleri kontrol et", "exec_command" to "Komut çalıştır", "read_file" to "Dosyayı oku", "write_file" to "Dosyayı kaydet", "apply_patch" to "Dosyayı düzenle", "update_plan" to "Planı güncelle", "request_user_input" to "Kullanıcıdan bilgi iste")
    return labels.entries.firstOrNull { value == it.key || value.endsWith("__" + it.key) || value.endsWith("." + it.key) }?.value ?: value
}
