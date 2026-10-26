package dev.agentworkspace

import android.Manifest
import android.annotation.SuppressLint
import android.app.Application
import android.content.pm.PackageManager
import android.media.*
import android.util.Base64
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import org.json.JSONObject

data class VoiceState(
    val active: Boolean = false,
    val phase: String = "Hazır",
    val muted: Boolean = false,
    val speakerMuted: Boolean = false,
    val level: Float = 0f,
    val configured: Boolean = false,
    val voiceId: String = "",
    val voices: List<Pair<String, String>> = emptyList(),
    val error: String? = null,
    val loading: Boolean = false,
)

class VoiceModel(app: Application) : AndroidViewModel(app) {
    val repo = Repository(app)
    private val prefs = app.getSharedPreferences("voice", 0)
    private val mutable =
        MutableStateFlow(VoiceState(speakerMuted = prefs.getBoolean("speakerMuted", false)))
    val state = mutable.asStateFlow()
    private var session: Job? = null
    private var generation = 0
    private var speech: Job? = null
    @Volatile private var recorder: AudioRecord? = null
    private val pending = ConcurrentLinkedQueue<Long>()
    private val audio = app.getSystemService(AudioManager::class.java)
    private val focus =
        AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build()
            )
            .setOnAudioFocusChangeListener { if (it < 0) stop() }
            .build()

    private fun update(f: (VoiceState) -> VoiceState) {
        mutable.update(f)
    }

    fun refreshSettings() {
        viewModelScope.launch {
            update { it.copy(loading = true, error = null) }
            try {
                val status = withContext(Dispatchers.IO) { repo.request("/v1/voice/status") }
                val list = withContext(Dispatchers.IO) { repo.request("/v1/voice/voices") }
                update {
                    it.copy(
                        configured = status.optBoolean("configured"),
                        voiceId = status.optString("voiceId"),
                        voices =
                            list.optJSONArray("voices")?.objects()?.map { v ->
                                v.getString("id") to v.getString("name")
                            } ?: emptyList(),
                    )
                }
            } catch (e: Exception) {
                update { it.copy(error = e.message) }
            } finally {
                update { it.copy(loading = false) }
            }
        }
    }

    fun configure(key: String = "", voiceId: String = "") {
        viewModelScope.launch {
            stop()
            update { it.copy(loading = true, error = null) }
            try {
                withContext(Dispatchers.IO) {
                    repo.request(
                        "/v1/voice/config",
                        JSONObject().apply {
                            if (key.isNotBlank()) put("apiKey", key.trim())
                            if (voiceId.isNotBlank()) put("voiceId", voiceId)
                        },
                    )
                }
                refreshSettings()
            } catch (e: Exception) {
                update { it.copy(error = e.message) }
            } finally {
                update { it.copy(loading = false) }
            }
        }
    }

    fun mute() {
        update { it.copy(muted = !it.muted) }
        runCatching { recorder?.stop() }
    }

    fun muteSpeaker() {
        update { it.copy(speakerMuted = !it.speakerMuted) }
        prefs.edit().putBoolean("speakerMuted", state.value.speakerMuted).apply()
        if (state.value.speakerMuted) speech?.cancel()
    }

    fun interrupt() {
        speech?.cancel()
    }

    fun permissionDenied() {
        update {
            it.copy(
                error =
                    "Sesli görüşme için mikrofon izni gerekli. Telefon ayarlarından izin verebilirsin."
            )
        }
    }

    fun stop() {
        generation++
        session?.cancel()
        session = null
        speech?.cancel()
        runCatching { recorder?.stop() }
        pending.clear()
        audio.abandonAudioFocusRequest(focus)
        update { it.copy(active = false, phase = "Hazır", level = 0f) }
    }

    fun dictate(onText: (String) -> Unit) {
        if (state.value.active) return
        if (getApplication<Application>().checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            update { it.copy(error = "Mikrofon izni gerekiyor.") }; return
        }
        val token = ++generation
        update { it.copy(active = true, muted = false, phase = "Dikte dinleniyor", error = null) }
        session = viewModelScope.launch {
            try {
                val bytes = capture() ?: throw IllegalStateException("Konuşma algılanamadı.")
                update { it.copy(phase = "Yazıya çevriliyor", level = 0f) }
                val result = withContext(Dispatchers.IO) { repo.request("/v1/voice/transcribe", JSONObject()
                    .put("clientRequestId", UUID.randomUUID().toString())
                    .put("audio", Base64.encodeToString(bytes, Base64.NO_WRAP)).put("draftOnly", true)) }
                if (token == generation) onText(result.getString("text"))
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { update { it.copy(error = e.message) } }
            finally { if (token == generation) update { it.copy(active = false, phase = "Hazır", level = 0f) } }
        }
    }

    fun start() {
        if (state.value.active) return
        if (
            getApplication<Application>().checkSelfPermission(Manifest.permission.RECORD_AUDIO) !=
                PackageManager.PERMISSION_GRANTED
        ) {
            permissionDenied()
            return
        }
        if (
            !state.value.configured ||
                state.value.voiceId.isBlank() ||
                state.value.voiceId == "null"
        ) {
            update {
                it.copy(error = "Önce Ayarlar bölümünden ElevenLabs bağlantısını ve sesini seç.")
            }
            return
        }
        if (audio.requestAudioFocus(focus) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
            update { it.copy(error = "Ses başka bir uygulama tarafından kullanılıyor.") }
            return
        }
        update { it.copy(active = true, error = null, phase = "Bağlanıyor") }
        val token = ++generation
        session =
            viewModelScope.launch {
                try {
                    coroutineScope {
                        var cursor =
                            withContext(Dispatchers.IO) {
                                repo.request("/v1/voice/status").getLong("cursor")
                            }
                        launch {
                            while (isActive) {
                                val result =
                                    withContext(Dispatchers.IO) {
                                        repo.request("/v1/voice/events?after=$cursor")
                                    }
                                for (event in
                                    result.optJSONArray("events")?.objects() ?: emptyList()) {
                                    if (event.optString("type") == "assistant_message")
                                        pending.add(event.getLong("id"))
                                    else
                                        throw IllegalStateException(
                                            "Asistanın ilerlemek için yardımına ihtiyacı var. Ayrıntılar sohbet ekranında."
                                        )
                                }
                                cursor = result.getLong("cursor")
                                delay(1000)
                            }
                        }
                        while (isActive) {
                            val event = pending.poll()
                            if (event != null) {
                                if (state.value.speakerMuted) continue
                                update { it.copy(phase = "Yanıt hazırlanıyor", level = 0f) }
                                speech = launch {
                                    val response =
                                        withContext(Dispatchers.IO) {
                                            repo.request(
                                                "/v1/voice/speech",
                                                JSONObject().put("eventId", event),
                                            )
                                        }
                                    update { it.copy(phase = "Konuşuyor") }
                                    play(Base64.decode(response.getString("audio"), Base64.DEFAULT))
                                }
                                speech?.join()
                                speech = null
                                continue
                            }
                            if (state.value.muted) {
                                update { it.copy(phase = "Mikrofon kapalı", level = 0f) }
                                delay(200)
                                continue
                            }
                            update { it.copy(phase = "Dinliyorum") }
                            val bytes = capture() ?: continue
                            update { it.copy(phase = "Sesin işleniyor", level = 0f) }
                            withContext(Dispatchers.IO) {
                                repo.request(
                                    "/v1/voice/transcribe",
                                    JSONObject()
                                        .put("clientRequestId", UUID.randomUUID().toString())
                                        .put("audio", Base64.encodeToString(bytes, Base64.NO_WRAP)),
                                )
                            }
                            // The main assistant can delegate and end a turn. Keep listening for
                            // new topics.
                        }
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    update { it.copy(error = e.message) }
                } finally {
                    if (generation == token) {
                        audio.abandonAudioFocusRequest(focus)
                        update { it.copy(active = false, phase = "Hazır", level = 0f) }
                    }
                }
            }
    }

    @SuppressLint("MissingPermission")
    private suspend fun capture(): ByteArray? =
        withContext(Dispatchers.IO) {
            val bufferSize =
                maxOf(
                    3200,
                    AudioRecord.getMinBufferSize(
                        16000,
                        AudioFormat.CHANNEL_IN_MONO,
                        AudioFormat.ENCODING_PCM_16BIT,
                    ),
                )
            val record =
                AudioRecord(
                    MediaRecorder.AudioSource.VOICE_RECOGNITION,
                    16000,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT,
                    bufferSize * 2,
                )
            if (record.state != AudioRecord.STATE_INITIALIZED) {
                record.release()
                throw IllegalStateException("Mikrofon başlatılamadı.")
            }
            recorder = record
            val output = ByteArrayOutputStream()
            val buffer = ShortArray(1600)
            var voiced = 0
            var silence = 0
            var blocks = 0
            try {
                record.startRecording()
                while (currentCoroutineContext().isActive && !state.value.muted && blocks < 300) {
                    if (pending.isNotEmpty() && voiced == 0) return@withContext null
                    val n = record.read(buffer, 0, buffer.size)
                    if (n <= 0) {
                        if (state.value.muted || !state.value.active) return@withContext null
                        throw IllegalStateException("Mikrofon kaydı kesildi.")
                    }
                    val rms = kotlin.math.sqrt(buffer.take(n).sumOf { it.toDouble() * it } / n)
                    update { it.copy(level = (rms / 6000).toFloat().coerceIn(0f, 1f)) }
                    if (rms > 450) {
                        voiced++
                        silence = 0
                    } else if (voiced > 0) silence++
                    for (i in 0 until n) {
                        output.write(buffer[i].toInt() and 255)
                        output.write((buffer[i].toInt() shr 8) and 255)
                    }
                    blocks++
                    if (voiced >= 3 && silence >= 12) break
                    if (voiced == 0 && blocks >= 80) return@withContext null
                }
                if (state.value.muted || voiced < 3) null else output.toByteArray()
            } finally {
                runCatching { record.stop() }
                record.release()
                if (recorder === record) recorder = null
            }
        }

    private suspend fun play(bytes: ByteArray) {
        val file =
            withContext(Dispatchers.IO) {
                File.createTempFile("voice-", ".mp3", getApplication<Application>().cacheDir)
                    .apply { writeBytes(bytes) }
            }
        val player = MediaPlayer()
        try {
            player.setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build()
            )
            player.setDataSource(file.path)
            suspendCancellableCoroutine<Unit> { continuation ->
                player.setOnPreparedListener { it.start() }
                player.setOnCompletionListener {
                    if (continuation.isActive) continuation.resume(Unit) {}
                }
                player.setOnErrorListener { _, _, _ ->
                    if (continuation.isActive)
                        continuation.resumeWith(
                            Result.failure(IllegalStateException("Ses çalınamadı."))
                        )
                    true
                }
                player.prepareAsync()
            }
        } finally {
            player.release()
            file.delete()
        }
    }

    override fun onCleared() {
        stop()
        super.onCleared()
    }
}
