package dev.agentworkspace

import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription

import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import java.io.File
import kotlinx.coroutines.launch
import org.json.JSONObject

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WorkspacePush.prepare(this)
        if (
            android.os.Build.VERSION.SDK_INT >= 33 &&
                checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) !=
                    android.content.pm.PackageManager.PERMISSION_GRANTED
        ) {
            registerForActivityResult(ActivityResultContracts.RequestPermission()) {}
                .launch(android.Manifest.permission.POST_NOTIFICATIONS)
        }
        enableEdgeToEdge()
        setContent {
            val model: WorkspaceModel = viewModel()
            val lifecycle = LocalLifecycleOwner.current.lifecycle
            DisposableEffect(lifecycle) {
                val observer = LifecycleEventObserver { _, event ->
                    if (event == Lifecycle.Event.ON_START) model.foreground(true)
                    else if (event == Lifecycle.Event.ON_STOP) model.foreground(false)
                }
                lifecycle.addObserver(observer)
                onDispose { lifecycle.removeObserver(observer) }
            }
            WorkspaceTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background,
                ) {
                    WorkspaceApp(model)
                }
            }
        }
    }
}

fun statusLabel(s: String) =
    when (s) {
        "pending" -> "Sırada"
        "running" -> "Çalışıyor"
        "waiting_children" -> "Alt görevleri bekliyor"
        "waiting_question" -> "Yanıtın gerekiyor"
        "completed" -> "Tur tamamlandı"
        "failed" -> "Hata / engel"
        "cancelled" -> "İptal edildi"
        "recovery_required" -> "Kurtarma gerekiyor"
        else -> s
    }

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun WorkspaceApp(model: WorkspaceModel) {
    val s by model.state.collectAsStateWithLifecycle()
    var tab by rememberSaveable { mutableStateOf("assistant") }
    var draft by
        remember(model.selected) {
            mutableStateOf(model.repo.local.get("draft:" + model.selected) ?: "")
        }
    fun changeDraft(value: String) {
        draft = value
        model.repo.local.put("draft:" + model.selected, value)
    }
    val voiceModel: VoiceModel = viewModel()
    val dictationState by voiceModel.state.collectAsStateWithLifecycle()
    val voiceLifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(voiceLifecycle) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_STOP) voiceModel.stop() }
        voiceLifecycle.addObserver(observer)
        onDispose { voiceLifecycle.removeObserver(observer); voiceModel.stop() }
    }
    fun dictate() {
        val target = model.selected
        voiceModel.dictate { text ->
            val old = model.repo.local.get("draft:" + target) ?: ""
            val next = listOf(old, text).filter { it.isNotBlank() }.joinToString(" ")
            model.repo.local.put("draft:" + target, next)
            if (model.selected == target) changeDraft(next)
        }
    }
    val dictatePermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { allowed -> if (allowed) dictate() else model.showError("Dikte için mikrofon izni gerekiyor.") }
    var showVoice by remember { mutableStateOf(false) }
    var showSessions by remember { mutableStateOf(false) }
    var showMenu by remember { mutableStateOf(false) }
    var showSettings by remember { mutableStateOf(false) }
    var settingsFromVoice by remember { mutableStateOf(false) }
    var navigationHistory by rememberSaveable { mutableStateOf(arrayListOf<String>()) }
    var sessionQuery by rememberSaveable { mutableStateOf("") }
    var activeJobsOnly by rememberSaveable { mutableStateOf(false) }
    if (showVoice)
        VoiceScreen(
            voiceModel,
            onClose = { showVoice = false },
            onSettings = {
                showVoice = false
                settingsFromVoice = true
                showSettings = true
            },
        )
    if (showSettings)
        SettingsScreen(
            voiceModel,
            model,
            onClose = {
                showSettings = false
                if (settingsFromVoice) showVoice = true
                settingsFromVoice = false
            },
        )
    var title by rememberSaveable { mutableStateOf("Asistan") }
    var showNew by remember { mutableStateOf(false) }
    val keyboardVisible = WindowInsets.isImeVisible
    var showAttachmentSource by remember { mutableStateOf(false) }
    val context = LocalContext.current
    var cameraUri by rememberSaveable { mutableStateOf<String?>(null) }
    var cameraPath by rememberSaveable { mutableStateOf<String?>(null) }
    val camera =
        rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { captured ->
            if (captured) cameraUri?.let { model.upload(Uri.parse(it), cameraPath?.let(::File)) }
            else cameraPath?.let { File(it).delete() }
            cameraPath = null
            cameraUri = null
        }
    var showExternal by remember { mutableStateOf(false) }
    var questionTask by remember { mutableStateOf<JSONObject?>(null) }
    var confirmCancel by remember { mutableStateOf<JSONObject?>(null) }
    var nativeProvider by remember { mutableStateOf("codex") }
    var showJobs by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val files =
        rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) {
            it?.let(model::upload)
        }
    if (!s.paired) {
        PairScreen(model, s)
        return
    }
    s.attachmentPreview?.let { preview ->
        AttachmentViewer(preview, onClose = model::closeAttachmentPreview)
    }
    val tasks = s.snapshot.optJSONArray("tasks")?.objects() ?: emptyList()
    val jobs =
        tasks.filter {
            it.optString("parentTaskId").isNotBlank() && it.optString("parentTaskId") != "null"
        }
    val sortedJobs =
        jobs.sortedWith(
            compareByDescending<JSONObject> { isActiveJob(it) }
                .thenByDescending { it.optLong("updatedAt", it.optLong("createdAt")) }
                .thenByDescending { it.optLong("createdAt") }
        )
    val activeJobs = sortedJobs.filter { isActiveJob(it) }
    val openJobs = activeJobs.size
    val selectedId =
        if (model.selected == "assistant") s.snapshot.optString("assistantId") else model.selected
    val current = tasks.find { it.optString("id") == selectedId }
    fun rememberPage() {
        val page =
            JSONObject()
                .put("tab", tab)
                .put("title", title)
                .put("drawer", showJobs)
                .put("selected", model.selected)
                .put("native", model.nativeSelection)
        navigationHistory = ArrayList(navigationHistory + page.toString())
    }
    fun returnToAssistant() {
        navigationHistory = arrayListOf()
        tab = "assistant"
        title = "Asistan"
        model.open("assistant")
    }
    fun goBack() {
        if (navigationHistory.isEmpty()) returnToAssistant()
        else {
            val page = JSONObject(navigationHistory.last())
            navigationHistory = ArrayList(navigationHistory.dropLast(1))
            tab = page.getString("tab")
            title = page.getString("title")
            val native = page.optJSONObject("native")
            if (native != null) model.openNative(native) else model.open(page.getString("selected"))
            if (page.optBoolean("drawer")) scope.launch { showJobs = true }
        }
    }
    val hasOverlay =
        showVoice ||
            showSettings || showSessions || showMenu || showJobs ||
            showNew ||
            showExternal ||
            showAttachmentSource ||
            questionTask != null ||
            confirmCancel != null ||
            s.attachmentPreview != null
    BackHandler(
        enabled =
            !keyboardVisible &&
                !hasOverlay &&
                (showJobs || tab != "assistant" || navigationHistory.isNotEmpty())
    ) {
        if (showJobs) scope.launch { showJobs = false } else goBack()
    }
    fun openTask(t: JSONObject) {
        rememberPage()
        model.open(t.getString("id"))
        title = t.optString("title")
        tab = "chat"
        scope.launch { showJobs = false }
    }
    if (showJobs) {
        ModalBottomSheet(onDismissRequest = { showJobs = false }) {
            Column(Modifier.fillMaxWidth().heightIn(max = 700.dp)) {
                Row(
                    Modifier.fillMaxWidth().padding(24.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            "İşlerin",
                            style = MaterialTheme.typography.headlineSmall,
                            fontWeight = FontWeight.Bold,
                        )
                        Text("Asistanın görev ağacı", style = MaterialTheme.typography.bodySmall)
                    }
                    IconButton(onClick = { scope.launch { showJobs = false } }) {
                        Icon(Icons.Default.Close, "Kapat")
                    }
                }
                LazyColumn(
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    item {
                        FilterChip(
                            selected = activeJobsOnly,
                            onClick = { activeJobsOnly = !activeJobsOnly },
                            label = { Text("Yalnızca aktif işler") },
                        )
                    }
                    if (jobs.isEmpty())
                        item {
                            Text(
                                "Henüz arka plan işi yok. Asistanına bir görev ver.",
                                Modifier.padding(8.dp),
                            )
                        }
                    items(
                        jobTree(jobs, s.snapshot.optString("assistantId"), activeJobsOnly),
                        key = { it.task.getString("id") },
                    ) { row ->
                        val t = row.task
                        Card(onClick = { openTask(t) }, colors = CardDefaults.cardColors(containerColor = Color.Transparent)) {
                            Column(Modifier.fillMaxWidth().padding(start = (16 + row.depth.coerceAtMost(5) * 14).dp, end = 16.dp, top = 12.dp, bottom = 12.dp)) {
                                Text(row.path.joinToString(" → "), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.secondary)
                                Text(
                                    t.optString("title"),
                                    fontWeight = FontWeight.SemiBold,
                                    maxLines = 2,
                                )
                                Text(
                                    statusLabel(t.optString("status")) +
                                        " · " +
                                        t.optString("provider"),
                                    style = MaterialTheme.typography.labelMedium,
                                    color = MaterialTheme.colorScheme.primary,
                                )
                                if (t.has("question"))
                                    TextButton(onClick = { questionTask = t }) {
                                        Text("Soruyu yanıtla")
                                    }
                            }
                        }
                    }
                }
            }
        }
    }
        Scaffold(
            modifier = Modifier.imePadding(),
            topBar = {
                TopAppBar(
                    title = {
                        Column {
                            Text(
                                if (tab == "sessions") "Oturumlar" else title,
                                fontWeight = FontWeight.SemiBold,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text(
                                if (s.online) "Bağlı · " + s.snapshot.optString("localDeviceId", "local") else "Bağlantı yok · yerel kayıt",
                                style = MaterialTheme.typography.labelSmall,
                                color =
                                    if (s.online) MaterialTheme.colorScheme.primary
                                    else MaterialTheme.colorScheme.error,
                            )
                        }
                    },
                    navigationIcon = {
                        if (tab == "chat")
                            IconButton(onClick = { goBack() }) {
                                Icon(Icons.AutoMirrored.Filled.ArrowBack, "Geri")
                            }
                    },
                    actions = {
                        IconButton(onClick = { showVoice = true }) { Icon(Icons.Default.GraphicEq, "Sesli asistan") }
                        TextButton(onClick = { scope.launch { showJobs = true } }, modifier = Modifier.semantics { contentDescription = "İşler, $openJobs aktif" }) { Text("$openJobs") }
                        Box {
                            IconButton(onClick = { showMenu = true }) { Icon(Icons.Default.MoreVert, "Sohbet menüsü") }
                            DropdownMenu(expanded = showMenu, onDismissRequest = { showMenu = false }, modifier = Modifier.width(300.dp)) {
                                Column(Modifier.padding(12.dp)) {
                                    Text("Model ve düşünme", style = MaterialTheme.typography.labelSmall)
                                    ModelControls(model, s.snapshot, Modifier.fillMaxWidth())
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        UsageLimits(model, current?.optString("deviceId")?.takeIf { it.isNotBlank() } ?: s.snapshot.optString("localDeviceId"), current?.optString("provider") ?: "codex")
                                        Text("Kalan kota", Modifier.padding(start = 8.dp))
                                    }
                                }
                                DropdownMenuItem(text = { Text("Oturumlar") }, leadingIcon = { Icon(Icons.Default.Forum, null) }, onClick = { showMenu = false; showSessions = true })
                                DropdownMenuItem(text = { Text("Yeni oturum") }, leadingIcon = { Icon(Icons.Default.Add, null) }, onClick = { showMenu = false; showNew = true })
                                DropdownMenuItem(text = { Text("Asistana dön") }, leadingIcon = { Icon(Icons.Default.ChatBubbleOutline, null) }, onClick = { showMenu = false; tab = "assistant"; title = "Asistan"; model.open("assistant") })
                                DropdownMenuItem(text = { Text("Ayarlar") }, leadingIcon = { Icon(Icons.Default.Settings, null) }, onClick = { showMenu = false; settingsFromVoice = false; showSettings = true })
                            }
                        }
                    },
                )
            },
            bottomBar = {
                Column {
                    if (tab != "sessions") {
                        if (s.attached.isNotEmpty())
                            androidx.compose.foundation.lazy.LazyRow(
                                contentPadding = PaddingValues(horizontal = 16.dp),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                items(s.attached) { (id, name) ->
                                    InputChip(
                                        selected = false,
                                        onClick = {
                                            model.openAttachment(ChatAttachment(id, name))
                                        },
                                        label = {
                                            val thumbnail = s.attachedThumbnails[id]
                                            if (thumbnail != null) coil3.compose.AsyncImage(model = thumbnail, contentDescription = name, modifier = Modifier.size(64.dp), contentScale = androidx.compose.ui.layout.ContentScale.Crop)
                                            else Text(name, maxLines = 1)
                                        },
                                        trailingIcon = {
                                            IconButton(
                                                onClick = { model.removeAttachment(id) },
                                                modifier = Modifier.size(24.dp),
                                            ) {
                                                Icon(
                                                    Icons.Default.Close,
                                                    "Eki kaldır: $name",
                                                    Modifier.size(16.dp),
                                                )
                                            }
                                        },
                                    )
                                }
                            }
                        if (s.rejected.isNotEmpty()) {
                            Column(Modifier.fillMaxWidth().padding(12.dp)) {
                                Text(
                                    "Gönderilemeyen mesajların korundu:",
                                    color = MaterialTheme.colorScheme.error,
                                )
                                androidx.compose.foundation.text.selection.SelectionContainer {
                                    Text(s.rejected.joinToString("\n") { it.second }, maxLines = 5)
                                }
                                TextButton(onClick = model::clearRejected) {
                                    Text("Kayıtları temizle")
                                }
                            }
                        }
                        if (s.pending > 0)
                            Row(
                                Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    "${s.pending} mesaj gönderilmeyi bekliyor",
                                    Modifier.weight(1f),
                                    style = MaterialTheme.typography.labelSmall,
                                )
                                TextButton(onClick = model::cancelPending) { Text("Kuyruğu sil") }
                            }
                        if (dictationState.active && !showVoice) Text(dictationState.phase, Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.labelSmall)
                        if (dictationState.error != null && !showVoice) Text(dictationState.error!!, Modifier.padding(horizontal = 16.dp), color = MaterialTheme.colorScheme.error)
                        Row(
                            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.Bottom,
                        ) {
                            key(tab, model.selected, model.nativeSelection?.optString("id")) {
                                RichMessageInput(value = draft, onValueChange = { changeDraft(it) }, onFile = { model.upload(it) }, modifier = Modifier.weight(1f))
                            }
                            IconButton(onClick = { if (dictationState.active) voiceModel.stop() else dictatePermission.launch(android.Manifest.permission.RECORD_AUDIO) }) {
                                Icon(if (dictationState.active) Icons.Default.Stop else Icons.Default.Mic, if (dictationState.active) "Dikteyi bitir" else "Dikte", tint = MaterialTheme.colorScheme.primary)
                            }
                            IconButton(
                                onClick = { showAttachmentSource = true },
                                enabled = !s.loading && s.attached.size < 5,
                            ) {
                                Icon(Icons.Default.AttachFile, "Dosya ekle")
                            }
                            IconButton(
                                onClick = {
                                    if (model.nativeSelection != null) showExternal = true
                                    else {
                                        model.send(draft)
                                        changeDraft("")
                                    }
                                },
                                enabled = draft.isNotBlank() && !s.loading,
                            ) {
                                Icon(
                                    Icons.AutoMirrored.Filled.Send,
                                    "Mesaj gönder",
                                    tint = MaterialTheme.colorScheme.primary,
                                )
                            }
                        }
                    }
                }
            },
        ) { padding ->
            Column(Modifier.fillMaxSize().padding(padding)) {
                if (s.error != null)
                    Surface(color = MaterialTheme.colorScheme.errorContainer) {
                        Row(
                            Modifier.fillMaxWidth().padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                s.error!!,
                                Modifier.weight(1f),
                                style = MaterialTheme.typography.bodySmall,
                                maxLines = 4,
                            )
                            IconButton(onClick = model::dismissError) {
                                Icon(Icons.Default.Close, "Hatayı kapat")
                            }
                        }
                    }
                if (s.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
                if (tab != "sessions") {
                    if (model.nativeSelection != null)
                        Text(
                            "Harici oturum · geçmiş görüntüleniyor. Devam etmeden önce terminaldeki aktif turu durdur.",
                            Modifier.padding(16.dp),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.secondary,
                        )
                    if (current?.has("question") == true)
                        FilledTonalButton(
                            onClick = { questionTask = current },
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                        ) {
                            Text("Bu iş yanıtını bekliyor")
                        }
                    if (activeJobs.isNotEmpty()) {
                        androidx.compose.foundation.lazy.LazyRow(
                            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            items(activeJobs, key = { it.getString("id") }) { job ->
                                AssistChip(
                                    onClick = { openTask(job) },
                                    label = {
                                        Text(
                                            job.optString("title"),
                                            Modifier.widthIn(max = 180.dp),
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis,
                                        )
                                    },
                                    leadingIcon = { JobIndicator(job.optString("status")) },
                                    shape = RoundedCornerShape(12.dp),
                                    colors =
                                        AssistChipDefaults.assistChipColors(
                                            containerColor =
                                                MaterialTheme.colorScheme.surfaceContainer
                                        ),
                                )
                            }
                        }
                    }
                    if (model.nativeSelection != null && s.historyCursor != null) {
                        TextButton(
                            onClick = { model.nativeSelection?.let { model.openNative(it, true) } },
                            enabled = !s.loading,
                        ) {
                            Text("Daha fazla geçmiş yükle")
                        }
                    }
                    val visibleLines = s.lines.sortedBy { it.order }
                    val workBefore = s.workGroups.values.groupBy { group -> visibleLines.firstOrNull { it.order > group.order }?.id }
                    val list = rememberLazyListState()
                    var initiallyPositioned by remember(model.selected) { mutableStateOf(false) }
                    LaunchedEffect(model.selected, visibleLines.size, visibleLines.lastOrNull()?.text) {
                        if (
                            visibleLines.isNotEmpty() &&
                                (!initiallyPositioned ||
                                    list.layoutInfo.totalItemsCount == 0 ||
                                    (list.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0) >=
                                        list.layoutInfo.totalItemsCount - 3)
                        ) {
                            list.scrollToItem(visibleLines.lastIndex)
                            initiallyPositioned = true
                        }
                    }
                    LazyColumn(
                        state = list,
                        modifier = Modifier.weight(1f).fillMaxWidth(),
                        contentPadding = PaddingValues(16.dp),
                        verticalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        if (visibleLines.isEmpty())
                            item {
                                Column(
                                    Modifier.fillMaxWidth().padding(top = 48.dp, bottom = 24.dp),
                                    horizontalAlignment = Alignment.CenterHorizontally,
                                ) {
                                    Surface(
                                        shape = RoundedCornerShape(12.dp),
                                        color = MaterialTheme.colorScheme.primaryContainer,
                                    ) {
                                        Icon(
                                            Icons.Default.Spa,
                                            null,
                                            Modifier.padding(24.dp).size(32.dp),
                                            tint = MaterialTheme.colorScheme.primary,
                                        )
                                    }
                                    Spacer(Modifier.height(24.dp))
                                    Text(
                                        "Bugün neyi halledelim?",
                                        style = MaterialTheme.typography.headlineSmall,
                                    )
                                    Spacer(Modifier.height(8.dp))
                                    Text(
                                        "İşleri bana bırak. Gelişmeleri burada takip et.",
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = MaterialTheme.colorScheme.secondary,
                                    )
                                }
                            }
                        items(visibleLines, key = { it.id }) { line ->
                            workBefore[line.id]?.forEach { group -> key(group.id) { WorkActivityGroup(group) } }
                            Row(
                                Modifier.fillMaxWidth(),
                                horizontalArrangement =
                                    if (line.role == "user") Arrangement.End else Arrangement.Start,
                            ) {
                                Surface(
                                    shape =
                                        RoundedCornerShape(12.dp),
                                    color =
                                        if (line.role == "user")
                                            MaterialTheme.colorScheme.surfaceContainer
                                        else if (line.role == "error")
                                            MaterialTheme.colorScheme.errorContainer
                                        else Color.Transparent,
                                    contentColor = MaterialTheme.colorScheme.onSurface,
                                    modifier =
                                        Modifier.widthIn(max = 620.dp)
                                            .fillMaxWidth(if (line.role == "user") 0.9f else 0.96f),
                                ) {
                                    Column(Modifier.padding(horizontal = if (line.role == "user") 16.dp else 0.dp, vertical = 12.dp)) {
                                        MarkdownMessage(line.text) { path -> model.openFileLink(path, (current ?: model.nativeSelection)?.optString("deviceId")?.takeIf { it.isNotBlank() } ?: s.snapshot.optString("localDeviceId")) }
                                        line.attachments.forEach { attachment ->
                                            Spacer(Modifier.height(10.dp))
                                            AttachmentCard(
                                                attachment,
                                                s.openingAttachment == attachment.id,
                                            ) {
                                                model.openAttachment(attachment)
                                            }
                                        }
                                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                            RawCopyButton(line.text)
                                            Spacer(Modifier.weight(1f))
                                            if (line.created > 0) Text(java.text.SimpleDateFormat("HH:mm", java.util.Locale.getDefault()).format(java.util.Date(line.created)), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                        }
                                    }
                                }
                            }
                        }
                        workBefore[null]?.forEach { group -> item(key = group.id) { WorkActivityGroup(group) } }
                        items((s.snapshot.optJSONArray("queuedMessages")?.objects() ?: emptyList()).filter { it.optString("taskId") == selectedId && !it.optString("text").startsWith("Background task event") }, key = { "queued:" + it.optString("id") }) { queued ->
                            Column(Modifier.fillMaxWidth().padding(12.dp)) {
                                Text("Sırada · " + queued.optString("text").lineSequence().first().take(160), maxLines = 2)
                                if (current?.optString("provider") == "codex") TextButton(onClick = { model.steerQueued(selectedId, queued.optString("id")) }) { Text("Şimdi yönlendir") }
                            }
                        }

                        if (current != null && isActiveJob(current))
                            item {
                                Row(
                                    Modifier.fillMaxWidth(),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    JobIndicator(current.optString("status"))
                                    Spacer(Modifier.width(8.dp))
                                    Text(
                                        if (current.optString("status") == "running") "Çalışıyorum"
                                        else statusLabel(current.optString("status")),
                                        modifier = Modifier.weight(1f),
                                        style = MaterialTheme.typography.bodySmall,
                                    )
                                    TextButton(onClick = { confirmCancel = current }) {
                                        Icon(Icons.Default.StopCircle, null, Modifier.size(16.dp))
                                        Spacer(Modifier.width(4.dp))
                                        Text("İptal et")
                                    }
                                }
                            }
                    }
                }
            }
        }
    if (showSessions) {
        ModalBottomSheet(onDismissRequest = { showSessions = false }) {
            Column(Modifier.fillMaxWidth().padding(20.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Oturumlar", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.weight(1f))
                    TextButton(onClick = { showSessions = false; showNew = true }) { Text("Yeni oturum") }
                }
                OutlinedTextField(sessionQuery, { sessionQuery = it }, label = { Text("Oturum ara") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                LazyColumn(Modifier.heightIn(max = 500.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    item { SessionCard("Asistan", "Kalıcı sohbet") { showSessions = false; tab = "assistant"; title = "Asistan"; model.open("assistant") } }
                    items(tasks.filter { it.optString("id") != s.snapshot.optString("assistantId") && it.optString("parentTaskId").let { p -> p.isBlank() || p == "null" } && it.optString("title").contains(sessionQuery, true) }.sortedByDescending { it.optLong("updatedAt") }, key = { it.optString("id") }) { t ->
                        SessionCard(t.optString("title"), t.optString("deviceId") + " · " + t.optString("provider")) { showSessions = false; openTask(t) }
                    }
                }
            }
        }
    }
    if (showAttachmentSource) {
        ModalBottomSheet(
            onDismissRequest = { showAttachmentSource = false },
            containerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
        ) {
            Text(
                "Sohbete ekle",
                Modifier.padding(horizontal = 24.dp, vertical = 12.dp),
                style = MaterialTheme.typography.titleLarge,
            )
            ListItem(
                headlineContent = { Text("Kamera") },
                supportingContent = { Text("Fotoğraf çek") },
                leadingContent = { Icon(Icons.Default.PhotoCamera, null) },
                modifier =
                    Modifier.clickable {
                        showAttachmentSource = false
                        try {
                            val dir = File(context.cacheDir, "camera").apply { mkdirs() }
                            val file = File.createTempFile("photo-", ".jpg", dir)
                            val uri =
                                FileProvider.getUriForFile(
                                    context,
                                    context.packageName + ".files",
                                    file,
                                )
                            cameraPath = file.absolutePath
                            cameraUri = uri.toString()
                            camera.launch(uri)
                        } catch (e: Exception) {
                            cameraPath?.let { File(it).delete() }
                            cameraPath = null
                            cameraUri = null
                            model.showError("Kamera açılamadı: " + e.localizedMessage)
                        }
                    },
            )
            ListItem(
                headlineContent = { Text("Dosya") },
                supportingContent = { Text("Görsel, PDF veya belge seç") },
                leadingContent = { Icon(Icons.Default.FolderOpen, null) },
                modifier =
                    Modifier.clickable {
                        showAttachmentSource = false
                        files.launch(
                            arrayOf("text/*", "image/*", "application/pdf", "application/json")
                        )
                    },
            )
            Spacer(Modifier.height(24.dp))
        }
    }
    if (showNew) {
        var provider by remember { mutableStateOf("codex") }
        var deviceId by remember { mutableStateOf(model.newDeviceId.ifBlank { s.snapshot.optString("defaultDeviceId", "local") }) }
        var chosenModel by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { showNew = false },
            title = { Text("Yeni oturum") },
            text = {
                Column {
                    Text("Çalışacağı cihaz")
                    (s.snapshot.optJSONArray("devices")?.objects() ?: emptyList()).forEach { device ->
                        FilterChip(selected = deviceId == device.optString("id"), onClick = { deviceId = device.optString("id") }, label = { Text(device.optString("name")) })
                    }

                    Text(
                        "Çalışma alanı: " + ((s.snapshot.optJSONArray("devices")?.objects() ?: emptyList()).find { it.optString("id") == deviceId }?.optString("cwd") ?: s.snapshot.optString("cwd")),
                        style = MaterialTheme.typography.bodySmall,
                    )
                    Row {
                        FilterChip(
                            selected = provider == "codex",
                            onClick = { provider = "codex" },
                            label = { Text("Codex") },
                        )
                        Spacer(Modifier.width(8.dp))
                        FilterChip(
                            selected = provider == "claude",
                            onClick = { provider = "claude" },
                            label = { Text("Claude") },
                        )
                    }
                    OutlinedTextField(
                        chosenModel,
                        { chosenModel = it },
                        label = { Text("Model · boşsa sağlayıcı varsayılanı") },
                    )
                    Text(
                        "İzin: " + s.snapshot.optString("ceiling"),
                        style = MaterialTheme.typography.labelSmall,
                    )
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        rememberPage()
                        model.newDeviceId = deviceId
                        model.newProvider = provider
                        model.newModel = chosenModel
                        model.newSession()
                        tab = "chat"
                        title = "Yeni " + provider + " oturumu"
                        showNew = false
                    }
                ) {
                    Text("Sohbeti aç")
                }
            },
            dismissButton = { TextButton(onClick = { showNew = false }) { Text("Vazgeç") } },
        )
    }
    if (showExternal)
        AlertDialog(
            onDismissRequest = { showExternal = false },
            title = { Text("Mevcut oturuma devam") },
            text = {
                Text(
                    "Harici terminalde bu oturumun aktif turunu durdurdun mu? Aynı oturuma iki yerden eşzamanlı yazma güvenli değildir."
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        model.send(draft, true)
                        changeDraft("")
                        showExternal = false
                    }
                ) {
                    Text("Durdurdum, devam et")
                }
            },
            dismissButton = { TextButton(onClick = { showExternal = false }) { Text("Vazgeç") } },
        )

    questionTask?.let { task ->
        val answers = remember(task.optString("id")) { mutableStateMapOf<String, String>() }
        val questions =
            task
                .optJSONObject("question")
                ?.optJSONObject("prompt")
                ?.optJSONArray("questions")
                ?.objects() ?: emptyList()
        AlertDialog(
            onDismissRequest = { questionTask = null },
            title = { Text("Yanıtın gerekiyor") },
            text = {
                Column {
                    Text(task.optString("title"), fontWeight = FontWeight.SemiBold)
                    questions.forEach { question ->
                        val key =
                            if (task.optString("provider") == "codex") question.optString("id")
                            else question.optString("question")
                        Text(question.optString("question"), Modifier.padding(vertical = 8.dp))
                        OutlinedTextField(
                            answers[key] ?: "",
                            { answers[key] = it },
                            label = { Text("Yanıtın") },
                        )
                    }
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        model.action(task, answers.toMap())
                        questionTask = null
                    },
                    enabled =
                        questions.isNotEmpty() &&
                            questions.all {
                                (answers[
                                        if (task.optString("provider") == "codex")
                                            it.optString("id")
                                        else it.optString("question")] ?: "")
                                    .isNotBlank()
                            },
                ) {
                    Text("Yanıtı ilet")
                }
            },
            dismissButton = { TextButton(onClick = { questionTask = null }) { Text("Sonra") } },
        )
    }
    confirmCancel?.let { task ->
        AlertDialog(
            onDismissRequest = { confirmCancel = null },
            title = { Text("İş iptal edilsin mi?") },
            text = { Text("Bu iş ve ona bağlı alt görevler durdurulacak. Geçmiş korunur.") },
            confirmButton = {
                TextButton(
                    onClick = {
                        model.action(task)
                        confirmCancel = null
                    }
                ) {
                    Text("İptal et")
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmCancel = null }) { Text("Devam etsin") }
            },
        )
    }
}

@Composable
fun SessionCard(title: String, subtitle: String, onClick: () -> Unit) {
    Surface(onClick = onClick, modifier = Modifier.fillMaxWidth(), color = Color.Transparent) {
        Column(Modifier.padding(vertical = 12.dp, horizontal = 4.dp)) {
            Text(title, maxLines = 2, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(8.dp))
            Text(
                subtitle,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.secondary,
            )
        }
    }
}

@Composable
fun PairScreen(model: WorkspaceModel, s: ScreenState) {
    var url by rememberSaveable { mutableStateOf(model.repo.vault.url) }
    var code by rememberSaveable { mutableStateOf("") }
    Column(
        Modifier.fillMaxSize()
            .safeDrawingPadding()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(
            Icons.Default.Hub,
            null,
            Modifier.size(48.dp),
            tint = MaterialTheme.colorScheme.primary,
        )
        Spacer(Modifier.height(24.dp))
        Text(
            "Bilgisayarınla\nbağlantı kur",
            style = MaterialTheme.typography.headlineLarge,
            fontWeight = FontWeight.Bold,
        )
        Text(
            "Oturumların bilgisayarında kalır. Telefonun Tailscale üzerinden bağlanır.",
            Modifier.padding(vertical = 16.dp),
            color = MaterialTheme.colorScheme.secondary,
        )
        OutlinedTextField(
            url,
            { url = it },
            label = { Text("HTTPS sunucu adresi") },
            placeholder = { Text("https://bilgisayar.tailnet.ts.net:9443") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            code,
            { code = it },
            label = { Text("Tek kullanımlık eşleme kodu") },
            visualTransformation = PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )
        Spacer(Modifier.height(24.dp))
        Button(
            onClick = { model.pair(url, code) },
            enabled = !s.loading && code.isNotBlank() && url.isNotBlank(),
            modifier = Modifier.fillMaxWidth().height(56.dp),
        ) {
            Text(if (s.loading) "Bağlanıyor…" else "Bilgisayara bağlan")
        }
        s.error?.let {
            Text(
                it,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(top = 16.dp),
            )
        }
        Text(
            "İlk sürüm · Yalnızca ön planda canlı güncelleme",
            Modifier.padding(top = 24.dp),
            style = MaterialTheme.typography.labelSmall,
        )
    }
}

@Composable
fun AttachmentCard(file: ChatAttachment, loading: Boolean, onClick: () -> Unit) {
    val type = file.name.substringAfterLast('.', "DOSYA").uppercase()
    val icon =
        when (type) {
            "PNG",
            "JPG",
            "JPEG",
            "WEBP" -> Icons.Default.Image
            "PDF" -> Icons.Default.PictureAsPdf
            else -> Icons.Default.Description
        }
    OutlinedCard(
        onClick = onClick,
        enabled = !loading,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors =
            CardDefaults.outlinedCardColors(
                containerColor = MaterialTheme.colorScheme.surface.copy(alpha = 0.65f)
            ),
    ) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(
                shape = RoundedCornerShape(6.dp),
                color = MaterialTheme.colorScheme.secondaryContainer,
            ) {
                Icon(
                    icon,
                    null,
                    Modifier.padding(10.dp).size(24.dp),
                    tint = MaterialTheme.colorScheme.onSecondaryContainer,
                )
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    file.name,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 2,
                    overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                )
                val size =
                    when {
                        file.size < 0 -> ""
                        file.size < 1024 -> " · ${file.size} B"
                        file.size < 1048576 -> " · ${file.size / 1024} KB"
                        else -> " · %.1f MB".format(file.size / 1048576.0)
                    }
                Text(
                    type + size,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.secondary,
                )
            }
            Spacer(Modifier.width(8.dp))
            if (loading) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
            else
                Icon(
                    Icons.Default.OpenInNew,
                    "Dosyayı aç",
                    Modifier.size(20.dp),
                    tint = MaterialTheme.colorScheme.primary,
                )
        }
    }
}

fun isActiveJob(task: JSONObject) =
    task.optString("status") !in listOf("completed", "cancelled", "failed")

@Composable
private fun JobIndicator(status: String) {
    val waiting = status in listOf("waiting_question", "recovery_required")
    val transition = rememberInfiniteTransition(label = "job status")
    val opacity by
        transition.animateFloat(
            initialValue = 0.35f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(tween(900), RepeatMode.Reverse),
            label = "status pulse",
        )
    val color =
        if (waiting) MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.primary
    Box(
        Modifier.size(12.dp)
            .semantics { contentDescription = statusLabel(status) }
            .alpha(if (waiting) 1f else opacity)
            .background(color, CircleShape)
    )
}

@Composable
fun WorkingTime(start: Long, end: Long) {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(start, end) {
        while (end == 0L && start > 0) {
            now = System.currentTimeMillis()
            kotlinx.coroutines.delay(1000)
        }
    }
    if (start > 0) {
        val seconds = ((if (end > 0) end else now) - start).coerceAtLeast(0) / 1000
        Text("${if (end > 0) "Worked for" else "Working for"} ${seconds / 60}m ${seconds % 60}s", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.secondary)
    }
}

@Composable
private fun RawCopyButton(text: String) {
    val context = LocalContext.current
    var copied by remember(text) { mutableStateOf(false) }
    LaunchedEffect(copied) { if (copied) { kotlinx.coroutines.delay(2000); copied = false } }
    TextButton(onClick = {
        val clipboard = context.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
        clipboard.setPrimaryClip(android.content.ClipData.newPlainText("Mesaj", text))
        copied = true
    }, contentPadding = PaddingValues(horizontal = 0.dp, vertical = 4.dp)) {
        Icon(Icons.Default.ContentCopy, null, Modifier.size(14.dp))
        Spacer(Modifier.width(6.dp))
        Text(if (copied) "Kopyalandı" else "Kopyala", style = MaterialTheme.typography.labelSmall)
    }
}
