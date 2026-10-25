package dev.agentworkspace

import android.app.Application
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import java.net.URLEncoder
import java.util.UUID
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONArray
import org.json.JSONObject

data class ChatAttachment(val id: String, val name: String, val size: Long = -1)

data class ChatLine(
    val id: String,
    val role: String,
    val text: String,
    val attachments: List<ChatAttachment> = emptyList(),
)

fun JSONArray.chatAttachments() =
    objects().map {
        ChatAttachment(it.optString("id"), it.optString("name"), it.optLong("size", -1))
    }

data class ScreenState(
    val paired: Boolean = false,
    val online: Boolean = false,
    val error: String? = null,
    val snapshot: JSONObject = JSONObject(),
    val lines: List<ChatLine> = emptyList(),
    val nativeSessions: List<JSONObject> = emptyList(),
    val toolLines: List<ChatLine> = emptyList(),
    val nativeCursor: String? = null,
    val historyCursor: String? = null,
    val pending: Int = 0,
    val rejected: List<Pair<String, String>> = emptyList(),
    val loading: Boolean = false,
    val openingAttachment: String? = null,
    val attachmentPreview: AttachmentPreview? = null,
    val attached: List<Pair<String, String>> = emptyList(),
)

fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }

class WorkspaceModel(app: Application) : AndroidViewModel(app) {
    val repo = Repository(app)
    private val mutable =
        MutableStateFlow(
            ScreenState(
                paired = repo.vault.token() != null,
                snapshot =
                    runCatching { JSONObject(repo.local.get("snapshot") ?: "{}") }
                        .getOrDefault(JSONObject()),
            )
        )
    val state = mutable.asStateFlow()
    var selected = "assistant"
        private set

    var nativeSelection: JSONObject? = null
        private set

    var newProvider = "codex"
    var newModel = ""
    private var polling: Job? = null
    private var attachmentJobs = 0
    private val refreshMutex = kotlinx.coroutines.sync.Mutex()

    init {
        start()
    }

    fun foreground(active: Boolean) {
        if (active) start()
        else {
            polling?.cancel()
            polling = null
        }
    }

    private fun start() {
        if (polling?.isActive == true) return
        polling =
            viewModelScope.launch {
                while (isActive) {
                    if (mutable.value.paired) refresh()
                    delay(2000)
                }
            }
    }

    private fun update(f: (ScreenState) -> ScreenState) {
        mutable.value = f(mutable.value)
    }

    fun dismissError() {
        update { it.copy(error = null) }
    }

    fun pair(url: String, code: String) {
        viewModelScope.launch {
            update { it.copy(loading = true) }
            try {
                withContext(Dispatchers.IO) { repo.pair(url, code) }
                update { it.copy(paired = true, error = null) }
                refresh()
            } catch (e: Exception) {
                update { it.copy(error = e.message) }
            } finally {
                update { it.copy(loading = false) }
            }
        }
    }

    fun open(id: String) {
        selected = id
        nativeSelection = null
        update {
            it.copy(
                lines =
                    runCatching { decodeLines(JSONArray(repo.local.get("chat:$id") ?: "[]")) }
                        .getOrDefault(emptyList()),
                attached = emptyList(),
            )
        }
        viewModelScope.launch { refresh() }
    }

    fun newSession() {
        selected = "new"
        nativeSelection = null
        update { it.copy(lines = emptyList(), attached = emptyList()) }
    }

    private fun text(content: Any?): String =
        when (content) {
            is String -> content
            is JSONArray ->
                content
                    .objects()
                    .mapNotNull { it.optString("text").takeIf(String::isNotBlank) }
                    .joinToString("\n")
            else -> ""
        }

    private fun decodeLines(a: JSONArray) =
        a.objects().map {
            ChatLine(
                it.optString("id"),
                it.optString("role"),
                it.optString("text"),
                it.optJSONArray("attachments")?.chatAttachments() ?: emptyList(),
            )
        }

    suspend fun refresh() {
        if (!refreshMutex.tryLock()) return
        try {
            val result =
                withContext(Dispatchers.IO) {
                    for ((id, path, raw) in repo.local.pending()) {
                        try {
                            repo.request(path, JSONObject(raw))
                            repo.local.done(id)
                        } catch (e: ApiError) {
                            if (e.status in 400..499 && e.status != 429) {
                                repo.local.failed(id)
                                throw e
                            } else throw e
                        }
                    }
                    repo.request("/v1/state").also { snapshot ->
                        repo.local.put("snapshot", snapshot.toString())
                        if (snapshot.optJSONObject("push")?.optBoolean("configured") == true) {
                            runCatching { WorkspacePush.register(getApplication(), repo) }
                        }
                    }
                }
            update {
                it.copy(
                    online = true,
                    snapshot = result,
                    pending = repo.local.pending().size,
                    rejected = repo.local.failures(),
                )
            }
            val id = if (selected == "assistant") result.optString("assistantId") else selected
            if (id.isNotBlank() && id != "new" && nativeSelection == null) {
                val events =
                    withContext(Dispatchers.IO) {
                        val all = JSONArray()
                        var offset = 0L
                        var count = 0
                        do {
                            val page = repo.request("/v1/messages?taskId=$id&after=$offset")
                            val messages = page.optJSONArray("messages") ?: JSONArray()
                            messages.objects().forEach { all.put(it) }
                            offset = page.optLong("nextOffset")
                            count = messages.length()
                        } while (count == 200 && all.length() < 4000)
                        all
                    }
                val tools =
                    events
                        .objects()
                        .filter {
                            it.optString("type") == "tool_item" &&
                                it.optJSONObject("payload")?.optString("type") !in
                                    listOf("userMessage", "agentMessage")
                        }
                        .map {
                            ChatLine(
                                "tool-" + it.optString("id"),
                                "tool",
                                it.optJSONObject("payload")?.toString(2)?.take(16000) ?: "",
                            )
                        }
                val completed =
                    events
                        .objects()
                        .filter { it.optString("type") == "assistant_message" }
                        .mapNotNull { it.optJSONObject("payload")?.optString("id") }
                        .toSet()
                val streams = linkedMapOf<String, StringBuilder>()
                events
                    .objects()
                    .filter { it.optString("type") == "assistant_delta" }
                    .forEach { e ->
                        val p = e.optJSONObject("payload") ?: JSONObject()
                        val item = p.optString("itemId")
                        if (item !in completed)
                            streams.getOrPut(item) { StringBuilder() }.append(p.optString("text"))
                    }
                val lines =
                    events.objects().mapNotNull { e ->
                        val payload = e.optJSONObject("payload") ?: JSONObject()
                        val type = e.optString("type")
                        val line =
                            when (type) {
                                "task_created" ->
                                    ChatLine(e.optString("id"), "user", payload.optString("task"))
                                "message_queued" ->
                                    ChatLine(
                                        e.optString("id"),
                                        "user",
                                        payload.optString("message"),
                                    )
                                "assistant_message" ->
                                    ChatLine(
                                        e.optString("id"),
                                        "assistant",
                                        payload.optString("text").ifBlank {
                                            text(payload.opt("content"))
                                        },
                                    )
                                "failed" ->
                                    ChatLine(e.optString("id"), "error", payload.optString("error"))
                                "question" ->
                                    ChatLine(
                                        e.optString("id"),
                                        "system",
                                        "Yanıtın gerekiyor. İşler bölümünden soruyu aç.",
                                    )
                                else -> null
                            }
                        line
                            ?.copy(
                                attachments =
                                    payload.optJSONArray("attachments")?.chatAttachments()
                                        ?: emptyList()
                            )
                            ?.takeIf {
                                it.text.isNotBlank() && !it.text.startsWith("Background task event")
                            }
                    }
                val current =
                    if (selected == "assistant") result.optString("assistantId") else selected
                if (current == id) {
                    update {
                        it.copy(
                            lines =
                                lines +
                                    streams.map { (key, value) ->
                                        ChatLine("stream-$key", "assistant", value.toString())
                                    },
                            toolLines = tools,
                        )
                    }
                    withContext(Dispatchers.IO) {
                        repo.local.put(
                            "chat:$selected",
                            JSONArray()
                                .apply {
                                    lines.forEach {
                                        put(
                                            JSONObject()
                                                .put("id", it.id)
                                                .put("role", it.role)
                                                .put("text", it.text)
                                                .put(
                                                    "attachments",
                                                    JSONArray(
                                                        it.attachments.map { a ->
                                                            JSONObject()
                                                                .put("id", a.id)
                                                                .put("name", a.name)
                                                                .put("size", a.size)
                                                        }
                                                    ),
                                                )
                                        )
                                    }
                                }
                                .toString(),
                        )
                    }
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            update {
                it.copy(
                    online = false,
                    error = e.message,
                    pending = repo.local.pending().size,
                    rejected = repo.local.failures(),
                )
            }
        } finally {
            refreshMutex.unlock()
        }
    }

    fun send(value: String, confirmExternal: Boolean = false) {
        if (value.isBlank() || attachmentJobs > 0) return
        val native = nativeSelection
        if (native != null && !confirmExternal) {
            update {
                it.copy(
                    error = "Harici oturuma devam etmek için terminal turunun durduğunu onayla."
                )
            }
            return
        }
        val id = UUID.randomUUID().toString()
        val body =
            JSONObject()
                .put("clientRequestId", id)
                .put("text", value)
                .put("provider", native?.optString("provider") ?: newProvider)
                .put("attachments", JSONArray(state.value.attached.map { it.first }))
        if (newModel.isNotBlank()) body.put("model", newModel)
        if (native != null)
            body.put("nativeId", native.getString("id")).put("confirmExternal", true)
        val path =
            when {
                selected == "assistant" -> "/v1/assistant/messages"
                selected == "new" || native != null -> "/v1/sessions/messages"
                else -> "/v1/tasks/$selected/messages"
            }
        repo.local.enqueue(id, path, body.toString())
        update {
            it.copy(
                pending = repo.local.pending().size,
                lines =
                    it.lines +
                        ChatLine(
                            id,
                            "user",
                            value,
                            it.attached.map { a -> ChatAttachment(a.first, a.second) },
                        ),
                attached = emptyList(),
            )
        }
        viewModelScope.launch {
            refresh()
            if (selected == "new" || native != null) {
                val task =
                    state.value.snapshot
                        .optJSONArray("inputs")
                        ?.objects()
                        ?.find { it.optString("id") == id }
                        ?.optString("taskId")
                if (!task.isNullOrBlank()) open(task)
            }
        }
    }

    fun clearRejected() {
        repo.local.failures().forEach { repo.local.done(it.first) }
        update { it.copy(rejected = emptyList()) }
    }

    fun cancelPending() {
        repo.local.pending().forEach { repo.local.done(it.first) }
        update { it.copy(pending = 0) }
    }

    fun listNative(provider: String, more: Boolean = false) {
        viewModelScope.launch {
            update { it.copy(loading = true) }
            try {
                val cursor = if (more) state.value.nativeCursor else null
                val result =
                    withContext(Dispatchers.IO) {
                        repo.request(
                            "/v1/native?provider=$provider" +
                                (cursor?.let { "&cursor=" + URLEncoder.encode(it, "UTF-8") } ?: "")
                        )
                    }
                update {
                    it.copy(
                        nativeSessions =
                            (if (more) it.nativeSessions else emptyList()) +
                                (result.optJSONArray("sessions")?.objects() ?: emptyList()),
                        nativeCursor =
                            result.optString("nextCursor").takeUnless { c ->
                                c == "null" || c.isBlank()
                            },
                    )
                }
            } catch (e: Exception) {
                update { it.copy(error = e.message) }
            } finally {
                update { it.copy(loading = false) }
            }
        }
    }

    fun openNative(session: JSONObject, more: Boolean = false) {
        nativeSelection = session
        selected = "external"
        val cursor = if (more) state.value.historyCursor else null
        update { it.copy(lines = if (more) it.lines else emptyList(), loading = true) }
        viewModelScope.launch {
            try {
                val r =
                    withContext(Dispatchers.IO) {
                        repo.request(
                            "/v1/native/messages?provider=${session.getString("provider")}&id=${session.getString("id")}" +
                                (cursor?.let { "&cursor=" + URLEncoder.encode(it, "UTF-8") } ?: "")
                        )
                    }
                val lines = mutableListOf<ChatLine>()
                r.optJSONArray("messages")?.objects()?.forEach { m ->
                    lines.add(
                        ChatLine(
                            m.optString("uuid"),
                            m.optString("type"),
                            text(m.optJSONObject("message")?.opt("content")),
                        )
                    )
                }
                r.optJSONObject("thread")?.optJSONArray("turns")?.objects()?.forEach { t ->
                    t.optJSONArray("items")?.objects()?.forEach { i ->
                        val type = i.optString("type")
                        if (type == "userMessage" || type == "agentMessage")
                            lines.add(
                                ChatLine(
                                    i.optString("id"),
                                    if (type == "userMessage") "user" else "assistant",
                                    i.optString("text").ifBlank { text(i.opt("content")) },
                                )
                            )
                    }
                }
                update { current ->
                    val page = lines.filter { it.text.isNotBlank() }
                    current.copy(
                        lines =
                            (if (!more) page
                                else if (session.optString("provider") == "codex")
                                    page + current.lines
                                else current.lines + page)
                                .distinctBy { it.id },
                        historyCursor =
                            r.optString("nextCursor").takeUnless { it.isBlank() || it == "null" },
                    )
                }
            } catch (e: Exception) {
                update { it.copy(error = e.message) }
            } finally {
                update { it.copy(loading = false) }
            }
        }
    }

    fun closeAttachmentPreview() {
        update { it.copy(attachmentPreview = null) }
    }

    fun openAttachment(attachment: ChatAttachment) {
        if (state.value.openingAttachment != null) return
        update { it.copy(openingAttachment = attachment.id) }
        viewModelScope.launch {
            try {
                val file =
                    withContext(Dispatchers.IO) {
                        val dir =
                            java.io
                                .File(getApplication<Application>().cacheDir, "attachments")
                                .apply { mkdirs() }
                        val cached =
                            java.io.File(
                                dir,
                                attachment.id +
                                    "-" +
                                    attachment.name.replace(Regex("[^\\p{L}\\p{N}._-]"), "_"),
                            )
                        if (!cached.exists()) {
                            val response = repo.request("/v1/attachments/" + attachment.id)
                            val bytes = Base64.decode(response.getString("content"), Base64.DEFAULT)
                            require(bytes.size <= 5 * 1024 * 1024) { "Dosya sınırı 5 MiB" }
                            val temp = java.io.File(dir, attachment.id + ".part")
                            temp.writeBytes(bytes)
                            check(temp.renameTo(cached)) { "Dosya kaydedilemedi" }
                        }
                        cached
                    }
                update { it.copy(attachmentPreview = AttachmentPreview(attachment.name, file)) }
            } catch (e: Exception) {
                update {
                    it.copy(
                        error =
                            if (e is android.content.ActivityNotFoundException)
                                "Bu dosya türünü açacak uygulama bulunamadı."
                            else e.message
                    )
                }
            } finally {
                update { it.copy(openingAttachment = null) }
            }
        }
    }

    fun upload(uri: Uri) {
        attachmentJobs++
        update { it.copy(loading = true) }
        viewModelScope.launch {
            try {
                val result =
                    withContext(Dispatchers.IO) {
                        val resolver = getApplication<Application>().contentResolver
                        val name =
                            resolver.query(uri, null, null, null, null)?.use { c ->
                                if (c.moveToFirst())
                                    c.getString(
                                        c.getColumnIndexOrThrow(OpenableColumns.DISPLAY_NAME)
                                    )
                                else null
                            } ?: "attachment.txt"
                        val bytes =
                            resolver.openInputStream(uri)!!.use { stream ->
                                val out = java.io.ByteArrayOutputStream()
                                val buffer = ByteArray(8192)
                                while (true) {
                                    val n = stream.read(buffer)
                                    if (n < 0) break
                                    require(out.size() + n <= 5 * 1024 * 1024) {
                                        "Dosya sınırı 5 MiB"
                                    }
                                    out.write(buffer, 0, n)
                                }
                                out.toByteArray()
                            }
                        require(bytes.size <= 5 * 1024 * 1024) { "Dosya sınırı 5 MiB" }
                        repo.request(
                            "/v1/upload",
                            JSONObject()
                                .put("id", UUID.randomUUID())
                                .put("name", name)
                                .put("content", Base64.encodeToString(bytes, Base64.NO_WRAP)),
                        )
                    }
                update {
                    it.copy(
                        attached =
                            it.attached + (result.getString("id") to result.getString("name"))
                    )
                }
            } catch (e: Exception) {
                update { it.copy(error = e.message) }
            } finally {
                attachmentJobs--
                update { it.copy(loading = attachmentJobs > 0) }
            }
        }
    }

    fun action(task: JSONObject, answer: Map<String, String>? = null) {
        viewModelScope.launch {
            try {
                val b =
                    JSONObject()
                        .put("taskId", task.getString("id"))
                        .put("clientRequestId", UUID.randomUUID())
                        .put("action", if (answer == null) "cancel" else "answer")
                if (answer != null) {
                    val q = task.getJSONObject("question")
                    b.put("questionId", q.getString("id"))
                    val answers = JSONObject()
                    q.optJSONObject("prompt")?.optJSONArray("questions")?.objects()?.forEach { item
                        ->
                        if (task.optString("provider") == "codex")
                            answers.put(
                                item.optString("id"),
                                JSONObject()
                                    .put(
                                        "answers",
                                        JSONArray().put(answer[item.optString("id")] ?: ""),
                                    ),
                            )
                        else
                            answers.put(
                                item.optString("question"),
                                answer[item.optString("question")] ?: "",
                            )
                    }
                    b.put("answer", answers)
                }
                withContext(Dispatchers.IO) { repo.request("/v1/task/action", b) }
                refresh()
            } catch (e: Exception) {
                update { it.copy(error = e.message) }
            }
        }
    }
}
