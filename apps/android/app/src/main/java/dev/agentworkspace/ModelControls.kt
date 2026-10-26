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
    var effortsOpen by remember { mutableStateOf(false) }
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
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        TextButton(onClick = { open = true }, modifier = Modifier.weight(1f)) { Text(current?.optString("label") ?: selected?.optString("model")?.takeIf { it.isNotBlank() } ?: "Model seç", maxLines = 1) }
        Box {
            TextButton(onClick = { effortsOpen = true }, enabled = (current?.optJSONArray("efforts")?.length() ?: 0) > 0) { Text(selected?.optString("effort")?.takeIf { it.isNotBlank() } ?: "Otomatik") }
            DropdownMenu(expanded = effortsOpen, onDismissRequest = { effortsOpen = false }) {
                val levels = current?.optJSONArray("efforts")
                (listOf("") + (0 until (levels?.length() ?: 0)).map { levels!!.getString(it) }).forEach { level ->
                    DropdownMenuItem(text = { Text(level.ifBlank { "Otomatik" }) }, onClick = {
                        choose(JSONObject().put("provider", current!!.getString("provider")).put("model", current.getString("model")).apply { if(level.isNotBlank()) put("effort", level) }); effortsOpen = false
                    })
                }
            }
        }
    }
    if(open) AlertDialog(onDismissRequest = { open = false }, title = { Text("Model seç") }, text = {
        Column {
            OutlinedTextField(value = search, onValueChange = { search = it }, label = { Text("Model ara") })
            if(error.isNotBlank()) Text(error, style = MaterialTheme.typography.bodySmall)
            Column(Modifier.heightIn(max = 360.dp).verticalScroll(rememberScrollState())) {
                models.filter { (it.optString("label") + it.optString("provider")).contains(search, true) }.forEach { row ->
                    TextButton(onClick = { choose(JSONObject().put("provider", row.getString("provider")).put("model", row.getString("model"))); open = false }, modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.fillMaxWidth()) { Text(row.getString("label")); Text(row.getString("provider"), style = MaterialTheme.typography.labelSmall) }
                    }
                }
            }
        }
    }, confirmButton = { TextButton(onClick = { open = false }) { Text("Kapat") } })
}
