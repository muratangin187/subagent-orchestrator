package dev.agentworkspace

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import android.webkit.*
import android.widget.Toast
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.FileProvider
import androidx.webkit.WebViewAssetLoader
import coil3.compose.AsyncImage
import java.io.File
import java.util.UUID
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

data class AttachmentPreview(val name: String, val file: File)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AttachmentViewer(preview: AttachmentPreview, onClose: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val save = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.CreateDocument("application/octet-stream")
    ) { uri ->
        if (uri != null) scope.launch {
            val success = withContext(Dispatchers.IO) {
                runCatching {
                    requireNotNull(context.contentResolver.openOutputStream(uri)).use { output ->
                        preview.file.inputStream().use { it.copyTo(output) }
                    }
                }.isSuccess
            }
            Toast.makeText(context, if (success) "Dosya kaydedildi" else "Dosya kaydedilemedi", Toast.LENGTH_LONG).show()
        }
    }
    val extension = preview.name.substringAfterLast('.', "").lowercase()
    Dialog(
        onDismissRequest = onClose,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Scaffold(
            modifier = Modifier.fillMaxSize(),
            topBar = {
                TopAppBar(
                    title = {
                        Text(
                            preview.name,
                            maxLines = 1,
                            overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                        )
                    },
                    navigationIcon = {
                        IconButton(onClick = onClose) {
                            Icon(Icons.Default.Close, "Önizlemeyi kapat")
                        }
                    },
                    actions = {
                        IconButton(onClick = { save.launch(preview.name) }) { Icon(Icons.Default.Download, "İndir") }
                        IconButton(
                            onClick = {
                                try {
                                    val uri =
                                        FileProvider.getUriForFile(
                                            context,
                                            context.packageName + ".files",
                                            preview.file,
                                        )
                                    val mime =
                                        when (extension) {
                                            "html",
                                            "htm" -> "text/html"
                                            else ->
                                                MimeTypeMap.getSingleton()
                                                    .getMimeTypeFromExtension(extension)
                                                    ?: "application/octet-stream"
                                        }
                                    val intent =
                                        Intent(Intent.ACTION_VIEW)
                                            .setDataAndType(uri, mime)
                                            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                                    context.startActivity(
                                        Intent.createChooser(intent, "Başka uygulamada aç")
                                    )
                                } catch (_: android.content.ActivityNotFoundException) {
                                    Toast.makeText(
                                            context,
                                            "Bu dosyayı açacak uygulama bulunamadı.",
                                            Toast.LENGTH_LONG,
                                        )
                                        .show()
                                }
                            }
                        ) {
                            Icon(Icons.Default.OpenInNew, "Başka uygulamada aç")
                        }
                    },
                )
            },
        ) { padding ->
            Box(Modifier.fillMaxSize().padding(padding)) {
                when (extension) {
                    "pdf" -> PdfPreview(preview.file)
                    "html",
                    "htm" -> HtmlPreview(preview.file)
                    "png",
                    "jpg",
                    "jpeg",
                    "gif",
                    "webp" ->
                        ZoomSurface {
                            var error by remember { mutableStateOf(false) }
                            AsyncImage(
                                model = preview.file,
                                contentDescription = preview.name,
                                modifier = Modifier.fillMaxSize(),
                                contentScale = ContentScale.Fit,
                                onError = { error = true },
                            )
                            if (error)
                                Text(
                                    "Görsel açılamadı. Başka bir uygulamada açmayı deneyebilirsin."
                                )
                        }
                    else -> TextPreview(preview.file)
                }
            }
        }
    }
}

@Composable
private fun ZoomSurface(content: @Composable () -> Unit) {
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    val state = rememberTransformableState { zoom, pan, _ ->
        scale = (scale * zoom).coerceIn(1f, 5f)
        offset = if (scale == 1f) Offset.Zero else offset + pan
    }
    Box(
        Modifier.fillMaxSize().clipToBoundsCompat().transformable(state),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier.fillMaxSize()
                .graphicsLayer(
                    scaleX = scale,
                    scaleY = scale,
                    translationX = offset.x,
                    translationY = offset.y,
                ),
            contentAlignment = Alignment.Center,
        ) {
            content()
        }
        TextButton(
            onClick = {
                scale = 1f
                offset = Offset.Zero
            },
            modifier = Modifier.align(Alignment.BottomEnd).padding(12.dp),
        ) {
            Text("Sığdır")
        }
    }
}

private fun Modifier.clipToBoundsCompat() = this.then(Modifier.graphicsLayer { clip = true })

@Composable
private fun PdfPreview(file: File) {
    var page by remember(file) { mutableIntStateOf(0) }
    var count by remember(file) { mutableIntStateOf(0) }
    var bitmap by remember(file) { mutableStateOf<Bitmap?>(null) }
    var error by remember(file) { mutableStateOf<String?>(null) }
    var loading by remember(file) { mutableStateOf(true) }
    LaunchedEffect(file, page) {
        loading = true
        error = null
        try {
            val result =
                withContext(Dispatchers.IO) {
                    ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY).use {
                        descriptor ->
                        PdfRenderer(descriptor).use { renderer ->
                            renderer.openPage(page).use { source ->
                                val ratio = source.height.toDouble() / source.width.coerceAtLeast(1)
                                val width =
                                    minOf(1600, kotlin.math.sqrt(4_000_000.0 / ratio).toInt())
                                        .coerceAtLeast(1)
                                val height = (width * ratio).toInt().coerceAtLeast(1)
                                val image =
                                    Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
                                image.eraseColor(android.graphics.Color.WHITE)
                                source.render(
                                    image,
                                    null,
                                    null,
                                    PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY,
                                )
                                image to renderer.pageCount
                            }
                        }
                    }
                }
            bitmap = result.first
            count = result.second
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (_: Exception) {
            error =
                "PDF açılamadı. Dosya bozuk veya parola korumalı olabilir. Başka uygulamada açmayı deneyebilirsin."
        } finally {
            loading = false
        }
    }
    Column(Modifier.fillMaxSize()) {
        Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
            if (loading) CircularProgressIndicator()
            else if (error != null) Text(error!!, Modifier.padding(24.dp))
            else
                key(page) {
                    ZoomSurface {
                        bitmap?.let {
                            Image(
                                it.asImageBitmap(),
                                "PDF sayfa ${page + 1}",
                                Modifier.fillMaxSize(),
                                contentScale = ContentScale.Fit,
                            )
                        }
                    }
                }
        }
        Row(
            Modifier.fillMaxWidth().padding(12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(onClick = { page-- }, enabled = !loading && page > 0) { Text("Önceki") }
            Text(if (count > 0) "${page + 1} / $count" else "PDF")
            TextButton(onClick = { page++ }, enabled = !loading && page + 1 < count) {
                Text("Sonraki")
            }
        }
    }
}

@Composable
private fun TextPreview(file: File) {
    var text by remember(file) { mutableStateOf<String?>(null) }
    LaunchedEffect(file) {
        text =
            withContext(Dispatchers.IO) {
                runCatching {
                        file.bufferedReader().use { reader ->
                            val chars = CharArray(100001)
                            var used = 0
                            while (used < chars.size) {
                                val n = reader.read(chars, used, chars.size - used)
                                if (n < 0) break
                                used += n
                            }
                            String(chars, 0, minOf(used, 100000)) +
                                if (used > 100000) "\n[Önizleme kısaltıldı]" else ""
                        }
                    }
                    .getOrElse { "Dosya okunamadı." }
            }
    }
    SelectionContainer {
        Text(
            text ?: "Yükleniyor…",
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace,
        )
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun HtmlPreview(file: File) {
    val domain = remember(file) { "preview-${UUID.randomUUID()}.invalid" }
    val address = "https://$domain/document/index.html"
    val loader =
        remember(file, domain) {
            WebViewAssetLoader.Builder()
                .setDomain(domain)
                .addPathHandler("/document/") { path ->
                    if (path != "index.html") null
                    else
                        WebResourceResponse(
                            "text/html",
                            "UTF-8",
                            200,
                            "OK",
                            mapOf(
                                "Content-Security-Policy" to
                                    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'",
                                "Cache-Control" to "no-store",
                            ),
                            file.inputStream(),
                        )
                }
                .build()
        }
    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { context ->
            WebView(context).apply {
                settings.apply {
                    javaScriptEnabled =
                        true // Local interactions only: no network, bridge, files or persistent
                             // storage.
                    allowFileAccess = false
                    allowContentAccess = false
                    domStorageEnabled = false
                    databaseEnabled = false
                    blockNetworkLoads = true
                    mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                    cacheMode = WebSettings.LOAD_NO_CACHE
                    setSupportZoom(true)
                    builtInZoomControls = true
                    displayZoomControls = false
                    useWideViewPort = true
                    loadWithOverviewMode = true
                }
                CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
                webViewClient =
                    object : WebViewClient() {
                        override fun shouldInterceptRequest(
                            view: WebView,
                            request: WebResourceRequest,
                        ): WebResourceResponse =
                            loader.shouldInterceptRequest(request.url)
                                ?: WebResourceResponse(
                                    "text/plain",
                                    "UTF-8",
                                    403,
                                    "Blocked",
                                    emptyMap(),
                                    "".byteInputStream(),
                                )

                        override fun shouldOverrideUrlLoading(
                            view: WebView,
                            request: WebResourceRequest,
                        ): Boolean = request.url.toString().substringBefore('#') != address
                    }
                loadUrl(address)
            }
        },
        onRelease = {
            it.stopLoading()
            it.destroy()
        },
    )
}
