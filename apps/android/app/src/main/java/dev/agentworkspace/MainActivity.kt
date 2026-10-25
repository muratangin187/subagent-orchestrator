package dev.agentworkspace

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
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
            val colors =
                if (isSystemInDarkTheme())
                    darkColorScheme(
                        primary = Color(0xff8bd5bb),
                        primaryContainer = Color(0xff234e40),
                        onPrimaryContainer = Color(0xffd5f4e6),
                        secondaryContainer = Color(0xff30473e),
                        surfaceContainer = Color(0xff1c2923),
                        secondary = Color(0xffb6ccbf),
                        surface = Color(0xff111a17),
                        background = Color(0xff111a17),
                    )
                else
                    lightColorScheme(
                        primary = Color(0xff176454),
                        primaryContainer = Color(0xffdcefe4),
                        onPrimaryContainer = Color(0xff163f31),
                        secondaryContainer = Color(0xffe2eae4),
                        surfaceContainer = Color(0xffedf2ee),
                        secondary = Color(0xff52665d),
                        surface = Color(0xfff7faf7),
                        background = Color(0xfff7faf7),
                    )
            MaterialTheme(colorScheme = colors) {
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WorkspaceApp(model: WorkspaceModel) {
    val s by model.state.collectAsStateWithLifecycle()
    var tab by rememberSaveable { mutableStateOf("assistant") }
    var draft by rememberSaveable { mutableStateOf("") }
    var title by rememberSaveable { mutableStateOf("Asistan") }
    var showNew by remember { mutableStateOf(false) }
    var showTools by remember { mutableStateOf(false) }
    var showExternal by remember { mutableStateOf(false) }
    var questionTask by remember { mutableStateOf<JSONObject?>(null) }
    var confirmCancel by remember { mutableStateOf<JSONObject?>(null) }
    var nativeProvider by remember { mutableStateOf("codex") }
    val drawer = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    val files =
        rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) {
            it?.let(model::upload)
        }
    if (!s.paired) {
        PairScreen(model, s)
        return
    }
    s.attachmentPreview?.let { (name, content) ->
        AlertDialog(
            onDismissRequest = model::closeAttachmentPreview,
            containerColor = MaterialTheme.colorScheme.surfaceContainer,
            title = { Text(name, maxLines = 2) },
            text = {
                androidx.compose.foundation.text.selection.SelectionContainer {
                    Text(
                        content,
                        modifier =
                            Modifier.heightIn(max = 460.dp).verticalScroll(rememberScrollState()),
                        fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = model::closeAttachmentPreview) { Text("Kapat") }
            },
        )
    }
    val tasks = s.snapshot.optJSONArray("tasks")?.objects() ?: emptyList()
    val jobs =
        tasks.filter {
            it.optString("parentTaskId").isNotBlank() && it.optString("parentTaskId") != "null"
        }
    val openJobs =
        jobs.count { it.optString("status") !in listOf("completed", "cancelled", "failed") }
    val selectedId =
        if (model.selected == "assistant") s.snapshot.optString("assistantId") else model.selected
    val current = tasks.find { it.optString("id") == selectedId }
    fun openTask(t: JSONObject) {
        model.open(t.getString("id"))
        title = t.optString("title")
        tab = "chat"
        scope.launch { drawer.close() }
    }
    ModalNavigationDrawer(
        drawerState = drawer,
        drawerContent = {
            ModalDrawerSheet(modifier = Modifier.widthIn(max = 360.dp)) {
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
                    IconButton(onClick = { scope.launch { drawer.close() } }) {
                        Icon(Icons.Default.Close, "Kapat")
                    }
                }
                LazyColumn(
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    if (jobs.isEmpty())
                        item {
                            Text(
                                "Henüz arka plan işi yok. Asistanına bir görev ver.",
                                Modifier.padding(8.dp),
                            )
                        }
                    items(
                        jobs.sortedBy {
                            if (it.optString("status") == "waiting_question") 0 else 1
                        },
                        key = { it.getString("id") },
                    ) { t ->
                        ElevatedCard(onClick = { openTask(t) }) {
                            Column(Modifier.fillMaxWidth().padding(16.dp)) {
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
        },
    ) {
        Scaffold(
            topBar = {
                TopAppBar(
                    title = {
                        Column {
                            Text(
                                if (tab == "sessions") "Oturumlar" else title,
                                fontWeight = FontWeight.SemiBold,
                                maxLines = 1,
                            )
                            Text(
                                if (s.online) "Bilgisayar bağlı" else "Bağlantı yok · yerel kayıt",
                                style = MaterialTheme.typography.labelSmall,
                                color =
                                    if (s.online) MaterialTheme.colorScheme.primary
                                    else MaterialTheme.colorScheme.error,
                            )
                        }
                    },
                    navigationIcon = {
                        if (tab == "chat")
                            IconButton(
                                onClick = {
                                    tab = "assistant"
                                    title = "Asistan"
                                    model.open("assistant")
                                }
                            ) {
                                Icon(Icons.AutoMirrored.Filled.ArrowBack, "Asistana dön")
                            }
                    },
                    actions = {
                        TextButton(onClick = { scope.launch { drawer.open() } }) {
                            Text("İşler · $openJobs")
                        }
                    },
                )
            },
            bottomBar = {
                Column {
                    if (tab != "sessions") {
                        if (s.attached.isNotEmpty())
                            Text(
                                s.attached.joinToString(" · ") { it.second },
                                Modifier.padding(horizontal = 16.dp),
                                style = MaterialTheme.typography.labelSmall,
                            )
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
                        Row(
                            Modifier.fillMaxWidth()
                                .imePadding()
                                .padding(horizontal = 12.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.Bottom,
                        ) {
                            IconButton(
                                onClick = {
                                    files.launch(
                                        arrayOf(
                                            "text/*",
                                            "image/*",
                                            "application/pdf",
                                            "application/json",
                                        )
                                    )
                                },
                                enabled = !s.loading && s.attached.size < 5,
                            ) {
                                Icon(Icons.Default.AttachFile, "Dosya ekle")
                            }
                            OutlinedTextField(
                                value = draft,
                                onValueChange = { draft = it },
                                placeholder = { Text("Mesajını yaz…") },
                                modifier = Modifier.weight(1f),
                                maxLines = 5,
                                shape = RoundedCornerShape(24.dp),
                            )
                            IconButton(
                                onClick = {
                                    if (model.nativeSelection != null) showExternal = true
                                    else {
                                        model.send(draft)
                                        draft = ""
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
                    NavigationBar {
                        NavigationBarItem(
                            selected = tab != "sessions",
                            onClick = {
                                tab = "assistant"
                                title = "Asistan"
                                model.open("assistant")
                            },
                            icon = { Icon(Icons.Default.ChatBubbleOutline, "Asistan") },
                            label = { Text("Asistan") },
                        )
                        NavigationBarItem(
                            selected = tab == "sessions",
                            onClick = {
                                tab = "sessions"
                                model.listNative(nativeProvider)
                            },
                            icon = { Icon(Icons.Default.Forum, "Oturumlar") },
                            label = { Text("Oturumlar") },
                        )
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
                if (tab == "sessions") {
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        FilterChip(
                            selected = nativeProvider == "codex",
                            onClick = {
                                nativeProvider = "codex"
                                model.listNative("codex")
                            },
                            label = { Text("Codex") },
                        )
                        Spacer(Modifier.width(8.dp))
                        FilterChip(
                            selected = nativeProvider == "claude",
                            onClick = {
                                nativeProvider = "claude"
                                model.listNative("claude")
                            },
                            label = { Text("Claude") },
                        )
                        Spacer(Modifier.weight(1f))
                        TextButton(onClick = { showNew = true }) { Text("＋ Yeni") }
                    }
                    LazyColumn(
                        contentPadding = PaddingValues(16.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        item {
                            Text(
                                "BU UYGULAMADA",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.secondary,
                            )
                        }
                        items(
                            tasks.filter { !it.has("parentTaskId") },
                            key = { "managed-" + it.getString("id") },
                        ) { t ->
                            SessionCard(
                                t.optString("title"),
                                t.optString("provider") + " · " + statusLabel(t.optString("status")),
                            ) {
                                openTask(t)
                            }
                        }
                        item {
                            Text(
                                "YEREL GEÇMİŞ",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.secondary,
                            )
                        }
                        items(s.nativeSessions, key = { "native-" + it.getString("id") }) { t ->
                            SessionCard(
                                t.optString("title"),
                                t.optString("provider") + " · Harici oturum",
                            ) {
                                model.openNative(t)
                                title = t.optString("title")
                                tab = "chat"
                            }
                        }
                        if (s.nativeCursor != null)
                            item {
                                TextButton(onClick = { model.listNative(nativeProvider, true) }) {
                                    Text("Daha fazla oturum")
                                }
                            }
                    }
                } else {
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
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                        horizontalArrangement = Arrangement.End,
                    ) {
                        TextButton(onClick = { showTools = !showTools }) {
                            Text(
                                if (showTools) "Sohbete dön"
                                else "Araç kayıtları (${s.toolLines.size})"
                            )
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
                    val visibleLines = if (showTools) s.toolLines else s.lines
                    val list = rememberLazyListState()
                    LaunchedEffect(visibleLines.size) {
                        if (visibleLines.isNotEmpty())
                            list.animateScrollToItem(visibleLines.lastIndex)
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
                                        shape = RoundedCornerShape(24.dp),
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
                            Row(
                                Modifier.fillMaxWidth(),
                                horizontalArrangement =
                                    if (line.role == "user") Arrangement.End else Arrangement.Start,
                            ) {
                                Surface(
                                    shape =
                                        RoundedCornerShape(
                                            topStart = 20.dp,
                                            topEnd = 20.dp,
                                            bottomStart = if (line.role == "user") 20.dp else 4.dp,
                                            bottomEnd = if (line.role == "user") 4.dp else 20.dp,
                                        ),
                                    color =
                                        if (line.role == "user")
                                            MaterialTheme.colorScheme.primaryContainer
                                        else if (line.role == "error")
                                            MaterialTheme.colorScheme.errorContainer
                                        else MaterialTheme.colorScheme.surfaceContainer,
                                    modifier =
                                        Modifier.widthIn(max = 620.dp)
                                            .fillMaxWidth(if (line.role == "user") 0.9f else 0.96f),
                                ) {
                                    Column(Modifier.padding(16.dp)) {
                                        if (line.role != "user")
                                            Text(
                                                if (line.role == "error") "Engel" else "Asistan",
                                                style = MaterialTheme.typography.labelSmall,
                                                color = MaterialTheme.colorScheme.primary,
                                            )
                                        if (showTools) SelectionContainerCompat(line.text)
                                        else MarkdownMessage(line.text)
                                        if (!showTools)
                                            line.attachments.forEach { attachment ->
                                                Spacer(Modifier.height(10.dp))
                                                AttachmentCard(
                                                    attachment,
                                                    s.openingAttachment == attachment.id,
                                                ) {
                                                    model.openAttachment(attachment)
                                                }
                                            }
                                    }
                                }
                            }
                        }
                        if (
                            current?.optString("status") in
                                listOf("pending", "running", "waiting_children")
                        )
                            item {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    CircularProgressIndicator(
                                        Modifier.size(16.dp),
                                        strokeWidth = 2.dp,
                                    )
                                    Spacer(Modifier.width(8.dp))
                                    Text(
                                        statusLabel(current!!.optString("status")),
                                        style = MaterialTheme.typography.bodySmall,
                                    )
                                }
                            }
                        if (
                            current != null &&
                                tab == "chat" &&
                                current.optString("status") !in
                                    listOf("completed", "failed", "cancelled")
                        )
                            item {
                                TextButton(onClick = { confirmCancel = current }) {
                                    Text("İşi ve alt görevleri iptal et")
                                }
                            }
                    }
                }
            }
        }
    }
    if (showNew) {
        var provider by remember { mutableStateOf("codex") }
        var chosenModel by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { showNew = false },
            title = { Text("Yeni oturum") },
            text = {
                Column {
                    Text(
                        "Çalışma alanı: " + s.snapshot.optString("cwd"),
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
                        draft = ""
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
fun SelectionContainerCompat(text: String) {
    androidx.compose.foundation.text.selection.SelectionContainer {
        Text(text, style = MaterialTheme.typography.bodyLarge, lineHeight = 24.sp)
    }
}

@Composable
fun SessionCard(title: String, subtitle: String, onClick: () -> Unit) {
    OutlinedCard(onClick = onClick, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp)) {
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
        shape = RoundedCornerShape(14.dp),
        colors =
            CardDefaults.outlinedCardColors(
                containerColor = MaterialTheme.colorScheme.surface.copy(alpha = 0.65f)
            ),
    ) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(
                shape = RoundedCornerShape(10.dp),
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
