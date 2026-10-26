package dev.agentworkspace

import android.annotation.SuppressLint
import android.webkit.*
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.ByteArrayInputStream

@Composable
fun InlineVisual(model: WorkspaceModel, visual: JSONObject) {
    val id = visual.optString("id")
    var html by remember(id) { mutableStateOf("") }
    var error by remember(id) { mutableStateOf(false) }
    var attempt by remember(id) { mutableIntStateOf(0) }
    var expanded by remember(id) { mutableStateOf(false) }
    LaunchedEffect(id, attempt) {
        error = false
        try { html = withContext(Dispatchers.IO) { model.repo.request("/v1/visuals/$id").getString("html") } }
        catch (_: Exception) { error = true }
    }
    val screenWidth = LocalConfiguration.current.screenWidthDp
    val height = visual.optJSONArray("measurements")?.objects()?.minByOrNull { kotlin.math.abs(it.optInt("width",375)-screenWidth) }?.optInt("height",600)?.coerceIn(200,1600) ?: 600
    Column(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(visual.optString("title"), Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
            TextButton(onClick = { expanded = true }, enabled = html.isNotEmpty()) { Text("Büyüt") }
        }
        if (error) TextButton(onClick = { attempt++ }) { Text("Görsel yüklenemedi · Yeniden dene") }
        else if (html.isEmpty()) Text("Görsel yükleniyor…")
        else VisualWebView(html, Modifier.fillMaxWidth().height(height.dp))
    }
    if (expanded) Dialog(onDismissRequest = { expanded = false }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize()) {
            Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
                TextButton(onClick = { expanded = false }) { Text("Kapat") }
                VisualWebView(html, Modifier.fillMaxWidth().weight(1f))
            }
        }
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun VisualWebView(html: String, modifier: Modifier) {
    val colors = MaterialTheme.colorScheme
    fun hex(color: androidx.compose.ui.graphics.Color) = String.format("#%06X", 0xFFFFFF and color.toArgb())
    val theme = JSONObject().put("type","workspace-theme").put("scheme",if(colors.surface.luminance()<0.5) "dark" else "light").put("colors",JSONObject().put("background",hex(colors.surface)).put("foreground",hex(colors.onSurface)).put("muted",hex(colors.onSurfaceVariant)).put("accent",hex(colors.primary)).put("border",hex(colors.outline)))
    // No native bridge, file access or network. Authenticated loading is native-only.
    AndroidView(modifier = modifier, factory = { context ->
        WebView(context).apply {
            setBackgroundColor(android.graphics.Color.TRANSPARENT)
            settings.javaScriptEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.domStorageEnabled = false
            settings.databaseEnabled = false
            settings.blockNetworkLoads = true
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            settings.javaScriptCanOpenWindowsAutomatically = false
            settings.setSupportMultipleWindows(false)
            webChromeClient = object : WebChromeClient() {
                override fun onPermissionRequest(request: PermissionRequest) { request.deny() }
            }
            val themed = html.replace("<html>", "<html style=\"color-scheme:${theme.getString("scheme")};--background:${hex(colors.surface)};--foreground:${hex(colors.onSurface)};--muted:${hex(colors.onSurfaceVariant)};--accent:${hex(colors.primary)};--border:${hex(colors.outline)}\">")
            val address = "https://visual.invalid/document"
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = true
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
                    if(request.url.toString() == address && request.isForMainFrame) {
                        return WebResourceResponse("text/html","UTF-8",200,"OK",mapOf("Content-Security-Policy" to "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"),themed.byteInputStream())
                    }
                    return WebResourceResponse("text/plain","UTF-8",403,"Blocked",emptyMap(),ByteArrayInputStream(ByteArray(0)))
                }
            }
            CookieManager.getInstance().setAcceptThirdPartyCookies(this,false)
            loadUrl(address)
        }
    }, onRelease = { it.stopLoading(); it.destroy() })
}
