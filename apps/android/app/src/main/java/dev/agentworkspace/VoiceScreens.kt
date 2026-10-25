package dev.agentworkspace

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle

@Composable
fun VoiceScreen(model: VoiceModel, onClose: () -> Unit, onSettings: () -> Unit) {
    val s by model.state.collectAsStateWithLifecycle()
    val permission =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { allowed ->
            if (allowed) model.start() else model.permissionDenied()
        }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) model.stop()
        }
        lifecycle.addObserver(observer)
        onDispose {
            lifecycle.removeObserver(observer)
            model.stop()
        }
    }
    LaunchedEffect(Unit) { model.refreshSettings() }
    val pulse by
        rememberInfiniteTransition(label = "avatar")
            .animateFloat(
                1f,
                1.04f,
                infiniteRepeatable(tween(1800), RepeatMode.Reverse),
                label = "breathing",
            )
    Dialog(
        onDismissRequest = onClose,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            Modifier.fillMaxSize(),
            color = Color(0xff111a17),
            contentColor = Color(0xffe7f3eb),
        ) {
            Column(
                Modifier.fillMaxSize().safeDrawingPadding().padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Asistanın", fontWeight = FontWeight.SemiBold, fontSize = 22.sp)
                        Text(
                            "Aynı sohbet, şimdi sesli",
                            color = Color(0xffa1b8ac),
                            fontSize = 13.sp,
                        )
                    }
                    IconButton(
                        onClick = {
                            model.stop()
                            onSettings()
                        }
                    ) {
                        Icon(Icons.Default.Tune, "Ses ayarları")
                    }
                    IconButton(onClick = onClose) {
                        Icon(Icons.Default.Close, "Sesli ekranı kapat")
                    }
                }
                Spacer(Modifier.weight(1f))
                Box(
                    Modifier.sizeIn(maxWidth = 310.dp, maxHeight = 310.dp).aspectRatio(1f),
                    contentAlignment = Alignment.Center,
                ) {
                    Box(
                        Modifier.fillMaxSize()
                            .graphicsLayer(
                                scaleX = if (s.active) pulse + s.level * 0.07f else 1f,
                                scaleY = if (s.active) pulse + s.level * 0.07f else 1f,
                            )
                            .border(
                                2.dp,
                                if (s.active) Color(0xff74cdb0) else Color(0xff29473b),
                                CircleShape,
                            )
                    )
                    Image(
                        painterResource(R.drawable.assistant_avatar),
                        "Asistan avatarı",
                        Modifier.fillMaxSize().padding(10.dp).clip(CircleShape),
                        contentScale = ContentScale.Crop,
                    )
                }
                Spacer(Modifier.height(28.dp))
                Text(s.phase, fontSize = 26.sp, fontWeight = FontWeight.Medium)
                Spacer(Modifier.height(10.dp))
                Text(
                    if (!s.configured) "Başlamak için ElevenLabs bağlantısını ekle."
                    else if (s.phase == "Konuşuyor") "Söz almak için aşağıdaki düğmeye dokun."
                    else if (s.phase == "Dinliyorum")
                        "Seni dinliyorum. Durakladığında sözünü alacağım."
                    else if (s.active) "Aynı asistan sohbetinde devam ediyoruz."
                    else "Konuşmayı başlat; işleri birlikte ilerletelim.",
                    color = Color(0xffa1b8ac),
                    style = MaterialTheme.typography.bodyMedium,
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                )
                s.error?.let {
                    Spacer(Modifier.height(12.dp))
                    Text(
                        it,
                        color = Color(0xffffb4ab),
                        textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                    )
                }
                Spacer(Modifier.weight(1f))
                if (!s.active)
                    Button(
                        onClick = {
                            if (s.configured) permission.launch(Manifest.permission.RECORD_AUDIO)
                            else onSettings()
                        },
                        enabled = !s.loading,
                        modifier = Modifier.fillMaxWidth().height(56.dp),
                    ) {
                        Icon(Icons.Default.GraphicEq, null)
                        Spacer(Modifier.width(10.dp))
                        Text(if (s.configured) "Görüşmeyi başlat" else "ElevenLabs bağla")
                    }
                else {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                        VoiceControl(
                            if (s.muted) Icons.Default.MicOff else Icons.Default.Mic,
                            if (s.muted) "Mikrofonu aç" else "Mikrofonu kapat",
                            s.muted,
                            model::mute,
                        )
                        VoiceControl(
                            if (s.speakerMuted) Icons.Default.VolumeOff else Icons.Default.VolumeUp,
                            if (s.speakerMuted) "Sesi aç" else "Sesi kapat",
                            s.speakerMuted,
                            model::muteSpeaker,
                        )
                        FilledIconButton(
                            onClick = model::stop,
                            modifier = Modifier.size(60.dp),
                            colors =
                                IconButtonDefaults.filledIconButtonColors(
                                    containerColor = Color(0xffa9373b)
                                ),
                        ) {
                            Icon(Icons.Default.CallEnd, "Görüşmeyi bitir", tint = Color.White)
                        }
                    }
                    if (s.phase == "Konuşuyor" || s.phase == "Yanıt hazırlanıyor")
                        TextButton(onClick = model::interrupt) {
                            Text("Söz al", color = Color(0xff8bd5bb))
                        }
                }
                Spacer(Modifier.height(18.dp))
                Text(
                    "Ses ve seslendirilecek yanıtlar ElevenLabs ile işlenir.",
                    fontSize = 11.sp,
                    color = Color(0xff8da398),
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                )
            }
        }
    }
}

@Composable
private fun VoiceControl(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    FilledTonalIconButton(
        onClick = onClick,
        modifier = Modifier.size(60.dp),
        colors =
            IconButtonDefaults.filledTonalIconButtonColors(
                containerColor = if (selected) Color(0xff4d3838) else Color(0xff254538)
            ),
    ) {
        Icon(icon, label, tint = Color(0xffd5f4e6))
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(model: VoiceModel, workspace: WorkspaceModel, onClose: () -> Unit) {
    val s by model.state.collectAsStateWithLifecycle()
    val w by workspace.state.collectAsStateWithLifecycle()
    var key by remember { mutableStateOf("") }
    LaunchedEffect(Unit) { model.refreshSettings() }
    Dialog(
        onDismissRequest = onClose,
        properties =
            DialogProperties(
                usePlatformDefaultWidth = false,
                securePolicy = androidx.compose.ui.window.SecureFlagPolicy.SecureOn,
            ),
    ) {
        Scaffold(
            topBar = {
                TopAppBar(
                    title = { Text("Ayarlar") },
                    navigationIcon = {
                        IconButton(onClick = onClose) {
                            Icon(Icons.Default.Close, "Ayarları kapat")
                        }
                    },
                )
            }
        ) { padding ->
            Column(
                Modifier.fillMaxSize()
                    .padding(padding)
                    .verticalScroll(rememberScrollState())
                    .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Text("Bağlantı", style = MaterialTheme.typography.titleLarge)
                OutlinedCard(Modifier.fillMaxWidth()) {
                    Column(
                        Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text(
                            if (w.online) "Bilgisayar bağlı" else "Bilgisayara ulaşılamıyor",
                            fontWeight = FontWeight.SemiBold,
                        )
                        Text(workspace.repo.vault.url, style = MaterialTheme.typography.bodySmall)
                        Text(
                            "Çalışma alanı: " + w.snapshot.optString("cwd"),
                            style = MaterialTheme.typography.bodySmall,
                        )
                        Text(
                            "İzin: " + w.snapshot.optString("ceiling"),
                            style = MaterialTheme.typography.bodySmall,
                        )
                        Text(
                            "Bildirimler: " +
                                (w.snapshot.optJSONObject("push")?.optString("status")
                                    ?: "Bilinmiyor"),
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
                Text("Sesli asistan", style = MaterialTheme.typography.titleLarge)
                Text(
                    "Konuşmalar aynı Codex asistanında ilerler. Ses ekranında mesajlar gösterilmez; geçmişin sohbet ekranında kalır.",
                    style = MaterialTheme.typography.bodyMedium,
                )
                OutlinedTextField(
                    key,
                    { key = it },
                    label = {
                        Text(
                            if (s.configured) "ElevenLabs anahtarını değiştir"
                            else "ElevenLabs API anahtarı"
                        )
                    },
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions =
                        androidx.compose.foundation.text.KeyboardOptions(
                            keyboardType = androidx.compose.ui.text.input.KeyboardType.Password,
                            autoCorrectEnabled = false,
                        ),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Text(
                    "Anahtar yalnızca bilgisayarında saklanır. Voices, Speech to Text ve Text to Speech izinleri gerekir.",
                    style = MaterialTheme.typography.bodySmall,
                )
                Button(
                    onClick = {
                        val value = key
                        key = ""
                        model.configure(value)
                    },
                    enabled = key.isNotBlank() && !s.loading,
                ) {
                    Text("Bağlantıyı kaydet")
                }
                if (s.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
                s.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                if (s.configured) {
                    Text("Ses seçimi", fontWeight = FontWeight.SemiBold)
                    s.voices.forEach { (id, name) ->
                        Row(
                            Modifier.fillMaxWidth()
                                .clickable(enabled = !s.loading) { model.configure(voiceId = id) }
                                .padding(vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            RadioButton(
                                selected = s.voiceId == id,
                                onClick = { model.configure(voiceId = id) },
                                enabled = !s.loading,
                            )
                            Text(name, Modifier.weight(1f))
                        }
                    }
                }
                HorizontalDivider()
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Yanıtları seslendir", Modifier.weight(1f))
                    Switch(checked = !s.speakerMuted, onCheckedChange = { model.muteSpeaker() })
                }
                Text(
                    "Görüşme ekranı kapanınca veya uygulama arka plana geçince mikrofon ve ses durur. Yeniden başlatmak için görüşme düğmesine dokun.",
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
}
