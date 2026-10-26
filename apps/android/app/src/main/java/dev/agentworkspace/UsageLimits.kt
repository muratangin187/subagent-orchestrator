package dev.agentworkspace

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import kotlin.math.roundToInt
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.URLEncoder
import java.text.DateFormat
import java.util.Date

@Composable
fun UsageLimits(model: WorkspaceModel, device: String, provider: String) {
    var providers by remember(device) { mutableStateOf(emptyList<JSONObject>()) }
    var error by remember(device) { mutableStateOf("") }
    var open by remember { mutableStateOf(false) }
    LaunchedEffect(device) {
        while (isActive) {
            try {
                val data = withContext(Dispatchers.IO) { model.repo.request("/v1/limits?deviceId=" + URLEncoder.encode(device, "UTF-8")) }
                providers = data.optJSONArray("providers")?.objects() ?: emptyList(); error = ""
            } catch (e: kotlinx.coroutines.CancellationException) { throw e }
              catch (_: Exception) { error = "Limitler güncellenemedi." }
            delay(60000)
        }
    }
    val current = providers.find { it.optString("provider") == provider }
    val windows = current?.optJSONArray("windows")?.objects() ?: emptyList()
    val used = windows.maxOfOrNull { it.optDouble("usedPercent") }
    val remaining = used?.let { (100.0 - it).coerceIn(0.0, 100.0) }
    Box {
        TextButton(onClick = { open = !open }, contentPadding = PaddingValues(4.dp), modifier = Modifier.semantics { contentDescription = "$provider kalan kota" }) {
            Box(Modifier.size(38.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(progress = { ((remaining ?: 0.0) / 100).toFloat() }, modifier = Modifier.fillMaxSize(), strokeWidth = 3.dp, trackColor = MaterialTheme.colorScheme.surfaceContainerHighest)
                Text(remaining?.let { "${it.roundToInt()}%" } ?: "—", style = MaterialTheme.typography.labelSmall)
            }
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }, modifier = Modifier.widthIn(max = 320.dp).heightIn(max = 480.dp)) {
            Column(Modifier.padding(16.dp)) {
                Text("Kalan kota · $device", style = MaterialTheme.typography.titleSmall)
                Text("Halka: $provider · en az kotası kalan dönem", style = MaterialTheme.typography.bodySmall)
                if(error.isNotBlank()) Text(error + " Son alınan değerler.", color = MaterialTheme.colorScheme.error)
                if(providers.isEmpty()) Text("Limit bilgisi bekleniyor…")
                providers.forEach { p ->
                    Spacer(Modifier.height(16.dp))
                    Text(if(p.optString("provider") == "codex") "Codex" else "Claude", style = MaterialTheme.typography.titleMedium)
                    if(p.has("error")) Text(p.optString("error"), style = MaterialTheme.typography.bodySmall)
                    p.optJSONArray("windows")?.objects()?.forEach { w ->
                        Spacer(Modifier.height(8.dp))
                        Text("${w.optString("label")} · %${(100.0 - w.optDouble("usedPercent")).coerceIn(0.0, 100.0).roundToInt()} kalan", style = MaterialTheme.typography.labelMedium)
                        LinearProgressIndicator(progress = { ((100.0 - w.optDouble("usedPercent")).coerceIn(0.0, 100.0) / 100).toFloat() }, modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp))
                        Text(if(w.has("resetsAt")) "Yenilenme: " + DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(w.optLong("resetsAt"))) else "Yenilenme zamanı bilinmiyor", style = MaterialTheme.typography.bodySmall)
                    }
                    Text("Kontrol: " + DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(p.optLong("checkedAt"))), style = MaterialTheme.typography.labelSmall)
                }
            }
        }
    }
}

data class JobTreeRow(val task: JSONObject, val depth: Int, val path: List<String>)
fun jobTree(tasks: List<JSONObject>, assistantId: String, activeOnly: Boolean = false): List<JobTreeRow> {
    val byId = tasks.associateBy { it.optString("id") }
    val sorted = tasks.filter { it.optString("id") != assistantId }.sortedWith(compareByDescending<JSONObject> { isActiveJob(it) }.thenByDescending { it.optLong("updatedAt") })
    val children = sorted.groupBy { t -> t.optString("parentTaskId").takeIf { it != assistantId && byId.containsKey(it) } }
    val rows = mutableListOf<JobTreeRow>(); val seen = mutableSetOf<String>()
    fun visit(t: JSONObject, depth: Int, path: List<String>) {
        if(!seen.add(t.optString("id"))) return
        rows.add(JobTreeRow(t, depth, path))
        children[t.optString("id")]?.forEach { visit(it, depth + 1, path + t.optString("title", "İş")) }
    }
    children[null]?.forEach { visit(it, 0, listOf(if(it.optString("parentTaskId") == assistantId) "Asistan" else "Üst görev")) }
    sorted.filter { it.optString("id") !in seen }.forEach { visit(it, 0, listOf("Görev bağlantısı")) }
    if (!activeOnly) return rows
    val keep = mutableSetOf<String>()
    sorted.filter { isActiveJob(it) }.forEach { task ->
        var cursor: JSONObject? = task
        val visited = mutableSetOf<String>()
        while (cursor != null && visited.add(cursor!!.optString("id"))) {
            keep.add(cursor!!.optString("id"))
            cursor = byId[cursor!!.optString("parentTaskId")]
        }
    }
    return rows.filter { it.task.optString("id") in keep }
}
