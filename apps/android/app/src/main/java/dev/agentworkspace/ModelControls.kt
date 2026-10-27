package dev.agentworkspace

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.URLEncoder

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ModelControls(model: WorkspaceModel, snapshot: JSONObject, modifier: Modifier = Modifier) {
    val taskId = if (model.selected == "assistant") snapshot.optString("assistantId") else model.selected
    val task = snapshot.optJSONArray("tasks")?.objects()?.find { it.optString("id") == taskId }
    val device = task?.optString("deviceId")?.takeIf { it.isNotBlank() } ?: model.newDeviceId.ifBlank { snapshot.optString("localDeviceId", "") }
    var models by remember(device) { mutableStateOf(emptyList<JSONObject>()) }
    var error by remember(device) { mutableStateOf("") }
    var picked by remember(model.selected) { mutableStateOf(model.selections[model.selected]) }
    val selected = picked ?: task
    var open by remember { mutableStateOf(false) }
    var search by remember { mutableStateOf("") }
    LaunchedEffect(device) {
        try {
            val result = withContext(Dispatchers.IO) { model.repo.request("/v1/models?catalog=true&deviceId=" + URLEncoder.encode(device, "UTF-8")) }
            models = result.optJSONArray("models")?.objects() ?: emptyList()
            error = result.optJSONObject("errors")?.let { e -> e.keys().asSequence().map { e.optString(it) }.joinToString(" ") } ?: ""
        } catch (e: Exception) { error = e.message ?: "Model listesi alınamadı" }
    }
    val current = models.find { it.optString("provider") == selected?.optString("provider") && it.optString("model") == selected?.optString("model") }
    fun choose(value: JSONObject) { picked = value; model.selections[model.selected] = value }
    TextButton(onClick = { open = true }, modifier = modifier) {
        Column(Modifier.fillMaxWidth()) {
            Text(current?.optString("label") ?: selected?.optString("model")?.takeIf { it.isNotBlank() } ?: "Model seç", maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
            Text(selected?.optString("effort")?.takeIf { it.isNotBlank() } ?: "Otomatik düşünme", style = MaterialTheme.typography.labelSmall)
        }
    }
    if (open) ModalBottomSheet(onDismissRequest = { open = false }) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("Model ve düşünme", Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
                TextButton(onClick = { open = false }) { Text("Bitti") }
            }
            OutlinedTextField(value = search, onValueChange = { search = it }, label = { Text("Model ara") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
            val levels = current?.optJSONArray("efforts")
            if (levels != null && levels.length() > 0) {
                Text("Düşünme seviyesi", style = MaterialTheme.typography.labelMedium)
                androidx.compose.foundation.lazy.LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    val choices = listOf("") + (0 until levels.length()).map { levels.getString(it) }
                    items(choices.size) { index ->
                        val level = choices[index]
                        FilterChip(selected = (selected?.optString("effort") ?: "") == level, onClick = {
                            choose(JSONObject().put("provider", current!!.getString("provider")).put("model", current.getString("model")).apply { if (level.isNotBlank()) put("effort", level) })
                        }, label = { Text(level.ifBlank { "Otomatik" }) })
                    }
                }
            }
            if (error.isNotBlank()) Text(error, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
            androidx.compose.foundation.lazy.LazyColumn(Modifier.fillMaxWidth().heightIn(max = 360.dp)) {
                val matching = models.filter { (it.optString("label") + it.optString("provider")).contains(search, true) }
                if (matching.isEmpty()) item { Text(if (models.isEmpty()) "Model listesi henüz hazır değil" else "Bu aramada model bulunamadı", Modifier.padding(vertical = 20.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) }
                items(matching.size) { index ->
                    val row = matching[index]
                    val isSelected = row.optString("provider") == selected?.optString("provider") && row.optString("model") == selected?.optString("model")
                    Surface(onClick = { choose(JSONObject().put("provider", row.getString("provider")).put("model", row.getString("model"))) }, color = if (isSelected) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surface, shape = MaterialTheme.shapes.medium) {
                        Row(Modifier.fillMaxWidth().padding(14.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Column(Modifier.weight(1f)) { Text(row.getString("label"), style = MaterialTheme.typography.bodyLarge); Text(row.getString("provider"), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                            if (isSelected) Text("Seçili", style = MaterialTheme.typography.labelSmall)
                        }
                    }
                }
            }
        }
    }
}
